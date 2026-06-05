const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFile = 'C:\\Users\\johny\\.gemini\\antigravity\\brain\\9745682c-4fa9-424f-9f5f-5722b4b69832\\.system_generated\\logs\\transcript.jsonl';
const baseFile = 'C:\\Users\\johny\\OneDrive\\Escritorio\\PROGRAMAS FINALES\\VidriosExito\\app\\js\\app.js';

async function runReconstruction() {
    // 1. Read log file line by line to collect all tool calls and their results
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const steps = [];
    for await (const line of rl) {
        try {
            steps.push(JSON.parse(line));
        } catch (e) {}
    }

    console.log(`Loaded ${steps.length} steps from log.`);

    // 2. Parse steps in order to find successful edits to app.js
    // We want to find the tool call, and then check the subsequent step (the result) to make sure it was successful (not an error).
    const successfulEdits = [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.tool_calls) {
            for (const call of step.tool_calls) {
                if (call.name === 'replace_file_content' || call.name === 'multi_replace_file_content') {
                    const args = call.args || {};
                    const file = args.TargetFile || args.AbsolutePath || '';
                    if (file.toLowerCase().includes('app.js')) {
                        // Find the result of this tool call.
                        // The tool execution result is usually the next step in the log.
                        let isSuccess = true;
                        for (let j = i + 1; j < Math.min(i + 5, steps.length); j++) {
                            const nextStep = steps[j];
                            if (nextStep.type === 'ERROR_MESSAGE' || (nextStep.status === 'ERROR')) {
                                // If we find an error message shortly after, assume it failed.
                                isSuccess = false;
                                break;
                            }
                        }

                        if (isSuccess) {
                            successfulEdits.push({
                                stepIndex: step.step_index,
                                name: call.name,
                                args: args
                            });
                        } else {
                            console.log(`Skipping failed edit at Step ${step.step_index}`);
                        }
                    }
                }
            }
        }
    }

    console.log(`Found ${successfulEdits.length} successful edits to app.js.`);

    // 3. Load base file content
    let content = fs.readFileSync(baseFile, 'utf8');
    console.log(`Initial base file size: ${content.length} characters, ${content.split('\n').length} lines.`);

    // 4. Apply edits sequentially
    let appliedCount = 0;
    for (const edit of successfulEdits) {
        if (edit.name === 'replace_file_content') {
            const target = edit.args.TargetContent;
            const replacement = edit.args.ReplacementContent;
            if (!target) continue;

            if (content.includes(target)) {
                content = content.replace(target, replacement);
                appliedCount++;
                console.log(`Step ${edit.stepIndex}: Successfully applied replace_file_content.`);
            } else {
                console.warn(`Step ${edit.stepIndex}: Warning - TargetContent not found in file.`);
            }
        } else if (edit.name === 'multi_replace_file_content') {
            const chunks = edit.args.ReplacementChunks || [];
            let chunksApplied = 0;
            for (const chunk of chunks) {
                const target = chunk.TargetContent;
                const replacement = chunk.ReplacementContent;
                if (!target) continue;

                if (content.includes(target)) {
                    content = content.replace(target, replacement);
                    chunksApplied++;
                }
            }
            if (chunksApplied > 0) {
                appliedCount++;
                console.log(`Step ${edit.stepIndex}: Successfully applied ${chunksApplied}/${chunks.length} chunks of multi_replace_file_content.`);
            } else {
                console.warn(`Step ${edit.stepIndex}: Warning - No chunks from multi_replace_file_content were found in file.`);
            }
        }
    }

    console.log(`Reconstruction complete. Applied ${appliedCount}/${successfulEdits.length} tool edits.`);
    console.log(`Final file size: ${content.length} characters, ${content.split('\n').length} lines.`);

    // 5. Write the reconstructed file
    fs.writeFileSync(baseFile, content);
    console.log('Successfully wrote reconstructed app.js!');
}

runReconstruction().catch(console.error);
