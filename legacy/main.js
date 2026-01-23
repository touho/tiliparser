/*
 tiliparser.js

 Created By Marko Rintamäki (2016-10-18)

 Tiliparser parses Nordea account transfers and shows you useful monthly information

 How to use:
 - Get your account transfer data from Nordea bank and save it on your drive
 - run 'node tiliparser.js <filename>' on the file
 */

var fs = require('fs');
var tiliparser = require('./tiliparser');

var filename = process.argv[2];
if (!filename) {
    console.log(`Parameter missing! Usage:\n> node tiliparser.js <filename>`);
    process.exit();
}
var fileContent = fs.readFileSync(filename).toString();
var tiliInfo = tiliparser.build(fileContent);
tiliparser.print(tiliInfo);
