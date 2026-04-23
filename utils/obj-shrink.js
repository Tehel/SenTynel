/*
    Tiny script to remove duplicated vertexes in .obj 3D models
*/

import fs from 'node:fs/promises';

async function main(filename) {
    const data = await fs.readFile(filename);
    const vs = [];
    const vIdx = {};
    const rep = {};
    const f = [];
    data.toString().replace(/\r/g, '').split('\n').forEach((line, i) => {
        let [a, v1, v2, v3] = line.split(' ');
        if (!a) return;
        if (a === 'v') {
            if (vIdx[line] === undefined) {
                vIdx[line] = vs.length
                vs.push(line);
            }
            rep[i + 1] = vIdx[line];
        } else if (a === 'f') {
            f.push({ v1: rep[v1] + 1, v2: rep[v2] + 1, v3: rep[v3] + 1 });
        }
    });
    let str = vs.join('\n') + '\n'
        + f.map(f => `f ${f.v1} ${f.v2} ${f.v3}`).join('\n') + '\n';
    const newFilename = filename.replace('.', '-new.');
    await fs.writeFile(newFilename, str);
}
main(process.argv[2]);
