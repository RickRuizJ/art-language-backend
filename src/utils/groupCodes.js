'use strict';
const {randomInt}=require('crypto');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
exports.generateJoinCode=()=>Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');
