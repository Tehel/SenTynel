import { GameObjType, generateLevel } from './terrain.js';

// max_trees = 48 - 3 * num_sents

console.log("levelId,nbSentries,nbTrees,totalEnergy,codeST");
for (let id = 0; id <= 9999; id++) {
    const level = generateLevel(id);
    const nbTrees = level.objects.filter(obj => obj.type == GameObjType.TREE).length;
    const totalEnergy = 10 + nbTrees + level.nbSentries * 3 + 1;
    console.log(`${id},${level.nbSentries},${nbTrees},${totalEnergy},${level.codes["PC/ST"]}`);
}

// nb of levels for each totalEnergy:
// 24,1
// 25,6
// 26,9
// 27,17
// 28,27
// 29,26
// 30,32
// 31,53
// 32,61
// 33,89
// 34,93
// 35,121
// 36,175
// 37,167
// 38,188
// 39,222
// 40,247
// 41,243
// 42,284
// 43,337
// 44,350
// 45,394
// 46,419
// 47,480
// 48,506
// 49,461
// 50,477
// 51,490
// 52,462
// 53,466
// 54,419
// 55,376
// 56,360
// 57,375
// 58,307
// 59,1260

// min: 1136,1,10,24,61469778
