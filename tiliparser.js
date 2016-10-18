/*
    tiliparser.js

    Created By Marko Rintamäki (2016-10-18)

    Tiliparser parses Nordea account transfers and shows you useful monthly information
 */

var fs = require('fs');

function parseDate(date) {
    var a = date.split('.');
    return new Date(a[2], a[1], a[0]);
}

function parseValue(value) {
    if (value)
        return +value.replace(',', '.');
    else
        return null;
}

class Item {
    constructor(row) {
        var items = row.split('\t');
        this.date = parseDate(items[0]);
        this.sum = parseValue(items[3]);
        this.other = (items[4] || '').toLowerCase();
        this.month = this.date.getMonth() + 1;
        this.year = this.date.getFullYear();
        this.section = `${ this.year }-${ ('0'+this.month).slice(-2) }`;
    }
    isValid() {
        if (isNaN(this.date)) return false;
        if (!this.sum) return false;
        if (this.other.length == 0) return false;

        return true;
    }
}

class Section {
    constructor(name) {
        this.name = name;
        this.items = [];
        this.positiveItems = [];
        this.negativeItems = [];
        this.sum = 0;
        this.numberOfSections = 1;
        this.otherCounts = {};
        this.otherSums = {};
    }
    addItem(i) {
        this.items.push(i);
        this.sum += i.sum;
        if (i.sum > 0)
            this.positiveItems.push(i);
        else
            this.negativeItems.push(i);

        if (this.otherCounts[i.other] === undefined) {
            this.otherCounts[i.other] = 0;
            this.otherSums[i.other] = 0;
        }
        this.otherCounts[i.other] = (this.otherCounts[i.other] || 0) + 1;
        this.otherSums[i.other] = (this.otherSums[i.other] || 0) + i.sum;
    }
    makeAverageSection(numberOfSections) {
        this.numberOfSections = numberOfSections;
    }
    _formatSum(sum) {
        sum = sum / this.numberOfSections;
        return sum.toFixed(2);
    }
    getGainSum() {
        return this._formatSum(this.positiveItems.reduce((prev, curr) => prev + curr.sum, 0));
    }
    getSpendSum() {
        return this._formatSum(this.negativeItems.reduce((prev, curr) => prev + curr.sum, 0));
    }
    getTotalSum() {
        return this._formatSum(this.sum);
    }
    _formatCount(count) {
        count = count / this.numberOfSections;
        return Math.round(count * 10) / 10;
    }
    print(detailed) {
        console.log();
        console.log(this.name);
        console.log(`  Gains: ${ this.getGainSum() } e (${ this._formatCount(this.positiveItems.length) })`);
        console.log(`  Spends: ${ this.getSpendSum() }e (${ this._formatCount(this.negativeItems.length) })`);
        console.log(`  TOTAL: ${ this.getTotalSum() }e (${ this._formatCount(this.items.length) })`);

        var topCountCount = detailed ? 5 : 3;
        var topSumCount = detailed ? 10 : 3;
        var topDataDelimiter = detailed ? '\n' : ', ';

        function formatTopDataItem(name, data) {
            if (detailed)
                return `         ${ name } (${ data })`;
            else
                return `${ name } (${ data })`;
        }
        function logTopData(description, data) {
            if (detailed)
                console.log(`  ${ description }:\n${ data }`);
            else
                console.log(`  ${ description }: ${ data }`);
        }

        var highestCountOthers = Object.keys(this.otherCounts).sort((a, b) => {
            return +(this.otherCounts[b] - this.otherCounts[a]);
        }).slice(0, topCountCount);
        var highestCountOthersString = highestCountOthers.map(o => formatTopDataItem(o, this._formatCount(this.otherCounts[o]))).join(topDataDelimiter);
        logTopData('Most transactions with', highestCountOthersString);

        var highestGainOthers = Object.keys(this.otherSums).sort((a, b) => {
            return +(this.otherSums[b] - this.otherSums[a]);
        }).slice(0, topSumCount);
        var highestGainOthersString = highestGainOthers.map(o => formatTopDataItem(o, this._formatCount(this.otherSums[o]))).join(topDataDelimiter);
        logTopData('Most gained from', highestGainOthersString);

        var highestSpendOthers = Object.keys(this.otherSums).sort((a, b) => {
            return -(this.otherSums[b] - this.otherSums[a]);
        }).slice(0, topSumCount);
        var highestSpendOthersString = highestSpendOthers.map(o => formatTopDataItem(o, this._formatCount(this.otherSums[o]))).join(topDataDelimiter);
        logTopData('Most spent to', highestSpendOthersString);
    }
}

function generateSections(filename) {
    var sections = {};
    function addItemToItsSection(i) {
        if (!sections[i.section]) {
            sections[i.section] = new Section(i.section);
        }

        sections[i.section].addItem(i);
    }

    var file = fs.readFileSync(filename).toString();
    var rows = file.split('\n\r');
    var items = rows.map(r => new Item(r)).filter(i => i.isValid());
    items.forEach(addItemToItsSection);

    return Object.keys(sections).sort().map(sKey => {
        return sections[sKey];
    });
}

// Monthly information
var filename = process.argv[2];
if (!filename) {
    console.log(`Parameter missing! Usage:\n> node tiliparser.js <filename>`);
    process.exit();
}
var sectionArray = generateSections(filename);
sectionArray.forEach(s => s.print());

console.log();
console.log('-----------------');


// Average information
if (sectionArray.length >= 5) {
    var middles = sectionArray.slice(1, sectionArray.length-1);
    var averageSection = new Section(`AVERAGE from ${ middles[0].name } to ${ middles[middles.length - 1].name } (${ middles.length } months)`);
    middles.forEach(s => {
        s.items.forEach(i => averageSection.addItem(i));
    });
    averageSection.makeAverageSection(middles.length);
    averageSection.print(true);
} else {
    console.log('You need atleast 5 months of transactions to calculate monthly average');
}


// Total information
var totalSection = new Section(`TOTAL from ${ sectionArray[0].name } to ${ sectionArray[sectionArray.length - 1].name } (${ sectionArray.length } months)`);
sectionArray.forEach(s => {
    s.items.forEach(i => totalSection.addItem(i));
});
totalSection.print(true);

console.log();
