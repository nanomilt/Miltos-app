import dotenv from 'dotenv';
import got from 'got';

dotenv.config();

const BASE_URL = process.env.DEV_SERVER_URL;  
const apiToken = process.env.API_TOKEN;
const waitForAnalysis = async (commitHash, maxWaitTime = 200000, checkInterval = 20000) => {
    console.log(`🔍 Waiting for analysis of commit: ${commitHash}...`);
    
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        try {
            const res = await getData(commitHash);
        

            // ✅ Check if analysis exists and exit loop immediately
            if (res && res.analyses && res.analyses.length > 0) {
                console.log("✅ Analysis is ready! Exiting loop.");
                return res; // 🛑 Exit function immediately
            }

            console.log("⏳ Analysis not ready, retrying...");
        } catch (error) {
            console.warn("⚠️ API request failed, retrying in 10s...", error.message);
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval)); // Wait before retrying
    }

    console.error("⏳ Timeout: Analysis did not complete in time.");
    throw new Error("Analysis timeout reached");
};






const getData = async (commitHash) => {
    try {
        // Using provided commit hash instead of hardcoded one
        const apiUrl = `${BASE_URL}/cyclopt/openapi/analyses/commit/${commitHash}`;
        

        // Send API request
        const res = await got.get(apiUrl, {
            headers: {
                'x-access-cyclopt-token': apiToken,
                'Accept': 'application/json',
            },
            responseType: 'json',
        });

        // Log full response
        console.log('Full Response:', JSON.stringify(res.body, null, 2));

        // Check if 'analyses' exists and return it
        if (res.body && res.body.analyses && res.body.analyses.length > 0) {
            const analysis = res.body.analyses[0]; // Assuming the first analysis object is what you need

            console.log('Characteristics:', JSON.stringify(analysis.characteristics, null, 2));
            console.log('Violations:', JSON.stringify(analysis.violations, null, 2));
            console.log('Metrics:', JSON.stringify(analysis.metrics, null, 2));

            return res.body;  // Return the full response body
        } else {
            console.warn('No analysis found in response.');
            return null; // If no analysis, return null
        }
    } catch (err) {
        console.error('Error:', err.response?.body || err.message);
        return null; // Return null on error
    }
};


export { getData, waitForAnalysis };