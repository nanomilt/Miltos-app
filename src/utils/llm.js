import { MODEL } from './index.js';
import got from 'got';

const LLM = async () => {
  const { PYTHON_API_URL, LLM_OAUTH } = process.env;
  const pythonBackend = got.extend({
    prefixUrl: PYTHON_API_URL,
    headers: {
      'Content-Type': 'application/json',
      authorization: LLM_OAUTH,
    },
    retry: {
      limit: 3, // total attempts = 1 initial + 4 retries
      methods: ['POST'],
      statusCodes: [408, 429, 500, 502, 503, 504],
      errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'],
      calculateDelay: ({ attemptCount, retryOptions }) => {
        // If we've already exhausted the `limit`, return 0 => no more retries
        if (attemptCount > retryOptions.limit) {
          return 0;
        }

        // Exponential backoff: e.g. 1s, 2s, 4s, 8s, ...
        const baseDelay = 1000; // 1 second
        const delay = Math.min(baseDelay * Math.pow(2, attemptCount - 1), 4000);

        console.log('Waited for:', delay, 'seconds');

        return delay;
      },
    },
  });

  console.log('started new thread');

  return {
    sendMessage: async (question, _) => {
      const { body: unparsedResponse } = await pythonBackend.post( {
        json: { message: question, model: MODEL },
      });
      const { response } = JSON.parse(unparsedResponse);
      return response;
    },
  };
};

export default LLM;