import dotenv from 'dotenv';
import got from 'got';

// Load environment variables from .env file
dotenv.config();

// Base URL for Cyclopt API
const BASE_URL = process.env.DEV_SERVER_URL;  
const apiToken = process.env.API_TOKEN;  

// Function to fetch analysis by commit hash
const fetchAnalysisByCommitHash = async (commitHash) => {
    try {
        // Ensure that the base URL ends with a slash and append the full endpoint
        const apiUrl = `${BASE_URL}/analyses/commit/${commitHash}`;  // Add '/' between base URL and endpoint

        // Log the API URL for debugging purposes
        console.log(`API URL: ${apiUrl}`);

        // Make the GET request to the Cyclopt API using 'got'
        const response = await got(apiUrl, {
            method: 'GET',
            headers: {
                'x-access-cyclopt-token': apiToken,  // Authorization token
                'Content-Type': 'application/json',  // Set the content type
            },
            responseType: 'json',  // Automatically parse the JSON response
        });

        // Return the parsed JSON data
        return response.body;  // This will be the analysis data for the commit
    } catch (error) {
        // Enhanced error handling to log the status code and response
        if (error.response) {
            console.error('Error Response:', error.response.body);  // The body of the response
            console.error('Status Code:', error.response.statusCode);  // The status code
        } else {
            console.error('Error:', error.message);  // General error message if no response is available
        }
        throw new Error('Failed to retrieve analysis data');
    }
};

// Example Usage
const commitHash = '52600fc3ceece6bcfcc090488feb6323de336a35'; // Replace with actual commit hash

fetchAnalysisByCommitHash(commitHash)
    .then((data) => {
        console.log('Analysis Data:', data);  // Print the data when the analysis is fetched successfully
    })
    .catch((error) => {
        console.error('Error:', error.message);  // Handle errors
    });
