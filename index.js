const { Client } = require('pg');
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

exports.handler = async (event) => {
    console.log("IN THE LAMBDA WITH EVENT: ", JSON.stringify(event, null, 2));

    let client;

    const workoutId = event.pathParameters["workout-id"];
    let completedExerciseId = event.pathParameters["exercise-id"] ?? 0;
    let exercise_id, goal_weight, start_time, end_time;

    try {
        const requestBody = event.body ? JSON.parse(event.body) : {};
        exercise_id = requestBody.exercise_id || null;
        goal_weight = requestBody.goal_weight || null;
        start_time = requestBody.start_time || null;
        end_time = requestBody.end_time || null;

        console.log("params: ", workoutId, exercise_id, goal_weight, start_time, end_time);

        if (!workoutId || !exercise_id) {
            throw new Error("workoutId and exerciseId are required");
        }

        const params = { Name: '/Life/LocalDatabase', WithDecryption: true };
        const data = await ssm.getParameter(params).promise();
        const dbConfig = JSON.parse(data.Parameter.Value);

        client = new Client({
            host: dbConfig.DB_HOST,
            database: dbConfig.DB_NAME,
            user: dbConfig.DB_USER,
            password: dbConfig.DB_PASSWORD,
            port: dbConfig.DB_PORT
        });

        await client.connect();

        if (!completedExerciseId) {
            // Check if the exercise already exists for the workout
            const existingExerciseRes = await client.query(
                'SELECT completed_exercise_id FROM fitness.completed_exercises WHERE completed_workout_id = $1 AND exercise_id = $2',
                [workoutId, exercise_id]
            );
            if (existingExerciseRes.rows.length > 0) {
                completedExerciseId = existingExerciseRes.rows[0].completed_exercise_id;
            } else {
                // Create new exercise
                const startTime = start_time || new Date().toISOString();
                const exerciseRes = await client.query(
                    'INSERT INTO fitness.completed_exercises (completed_workout_id, exercise_id, start_time) VALUES ($1, $2, $3) RETURNING completed_exercise_id',
                    [workoutId, exercise_id, startTime]
                );
                completedExerciseId = exerciseRes.rows[0].completed_exercise_id;
            }
        } else {
            // Update existing exercise
            const endTime = end_time || new Date().toISOString();
            const exerciseRes = await client.query(
                'UPDATE fitness.completed_exercises SET end_time = $1 WHERE completed_exercise_id = $2 RETURNING completed_exercise_id',
                [endTime, completedExerciseId]
            );
            completedExerciseId = exerciseRes.rows[0].completed_exercise_id;
        }

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify({ status: 'success', completedExerciseId }),
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            body: JSON.stringify({ error: 'Internal Server Error', message: err.message }),
        };
    } finally {
        if (client) {
            await client.end();
        }
    }
};
