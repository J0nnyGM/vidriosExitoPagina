const fs = require('fs');
const readline = require('readline');

const logFile = 'C:\\Users\\johny\\.gemini\\antigravity\\brain\\9745682c-4fa9-424f-9f5f-5722b4b69832\\.system_generated\\logs\\transcript.jsonl';

async function recover() {
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let found = [];

    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            if (data.tool_calls) {
                for (const call of data.tool_calls) {
                    const args = call.args || {};
                    const argString = JSON.stringify(args);
                    if (argString.toLowerCase().includes('app.js')) {
                        found.push({
                            step: data.step_index,
                            name: call.name,
                            keys: Object.keys(args),
                            argStringLen: argString.length
                        });
                    }
                }
            }
        } catch (e) {}
    }

    console.log(`Found ${found.length} occurrences in logs.`);
    found.forEach(f => {
        console.log(`Step ${f.step}: Tool = ${f.name}, Keys = [${f.keys.join(', ')}], Args length = ${f.argStringLen}`);
    });
}

recover().catch(console.error);
