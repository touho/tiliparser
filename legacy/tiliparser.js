/*
    tiliparser.js

    Created By Marko Rintamäki (2016-10-18)

    Tiliparser parses Nordea account transfers and shows you useful monthly information

    How to use:
    - Get your account transfer data from Nordea bank and save it on your drive
    - run 'node tiliparser.js <filename>' on the file
 */

var MINIMUM_SECTIONS_FOR_AVERAGE = 5;

if (typeof module === 'object')
    var tiliparser = module.exports;
else
    var tiliparser = {};

tiliparser.build = data => {

    // Monthly
    var sections = buildTiliparserSections(data);

    if (sections.length == 0)
        return null;

    // Average
    var averageSection = null;
    if (sections.length >= MINIMUM_SECTIONS_FOR_AVERAGE) {
        let middles = sections.slice(1, sections.length-1);
        averageSection = new TiliparserSection(`AVERAGE from ${ middles[0].name } to ${ middles[middles.length - 1].name } (${ middles.length } months)`);
        middles.forEach(s => {
            s.items.forEach(i => averageSection.addItem(i));
        });
        averageSection.makeAverageSection(middles.length);
    }

    // Total
    var totalSection = null;
    if (sections.length > 0) {
        totalSection = new TiliparserSection(`TOTAL from ${ sections[0].name } to ${ sections[sections.length - 1].name } (${ sections.length } months)`);
        sections.forEach(s => {
            s.items.forEach(i => totalSection.addItem(i));
        });
    }

    // Recurring
    var recurring = null;
    if (sections.length > 0) {
        recurring = {
            sums: {},
            others: {}
        };
        sections.forEach(s => {
            s.items.forEach(i => {
                let monthKey = '' + i.date.getFullYear() + '-' + i.date.getMonth();
                if (!recurring.sums[i.sum]) {
                    recurring.sums[i.sum] = { name: ''+i.sum, count: 0, others: [], total: 0, months: {} }
                }
                recurring.sums[i.sum].count++;
                recurring.sums[i.sum].total += i.sum;
                recurring.sums[i.sum].others.push(i.other);
                recurring.sums[i.sum].months[monthKey] = true;

                if (!recurring.others[i.other]) {
                    recurring.others[i.other] = { name: i.other, count: 0, sums: [], total: 0, months: {} }
                }
                recurring.others[i.other].count++;
                recurring.others[i.other].total += i.sum;
                recurring.others[i.other].sums.push(i.sum);
                recurring.others[i.other].months[monthKey] = true;
            });
        });
        function handleRecurringItem(obj, key, array) {
            if (obj[key].count == 1 || Object.keys(obj[key].months).length == 1) {
                delete obj[key];
            } else {
                obj[key].months = Object.keys(obj[key].months).length;
                array.push(obj[key]);
            }
        }
        let sumArray = [];
        for (let sum in recurring.sums) {
            handleRecurringItem(recurring.sums, sum, sumArray);
        }

        let otherArray = [];
        for (let other in recurring.others) {
            handleRecurringItem(recurring.others, other, otherArray);
        }

        let sort = (a, b) => {
            if (a.months > b.months) return -1;
            if (a.months < b.months) return 1;
            if (Math.abs(a.total) > Math.abs(b.total)) return -1;
            return 1;
        };

        recurring.sums = sumArray.sort(sort);
        recurring.others = otherArray.sort(sort);
    }

    return {
        sections,
        averageSection,
        totalSection,
        recurring,
    };
}

tiliparser.print = sectionData => {
    if (!sectionData) {
        console.log('Invalid data');
        return;
    }

    sectionData.sections.forEach(s => s.print());

    console.log();
    console.log('-----------------');

    if (sectionData.averageSection)
        sectionData.averageSection.print(true);
    else
        console.log(`You need atleast ${ MINIMUM_SECTIONS_FOR_AVERAGE } months of transactions to calculate monthly average`);

    if (sectionData.totalSection)
        sectionData.totalSection.print(true);
    else
        console.log(`No data available`);

    if (sectionData.recurring) {
        console.log("sectionData.recurring");
        console.log(JSON.stringify(sectionData.recurring, null, 2));
    }

    console.log();
}

var tiliparsers = {
    nordea: {
        name: 'nordea',
        dateIndex: 0,
        valueIndex: 1,
        otherIndex: 5, // Source or destination of money
        otherFallbackIndex: -1,
        getRows(data) {
            return data.split('\n');
        },
        getItems(row) {
            return row.split(';');
        }
    },
    op: {
        name: 'op',
        dateIndex: 0,
        valueIndex: 2,
        otherIndex: 5, // Source or destination of money
        otherFallbackIndex: -1,
        getRows(data) {
            return data.split('\n');
        },
        getItems(row) {
            return row.split(';');
        }
    }
};

function getParser(data) {
    // Only nordea csv supported now
    return tiliparsers.nordea;
}

function parseTiliparserDate(date) {
    if (typeof date != "string") {
        return new Date();
    }
    if (date.indexOf("/") >= 0) {
        return new Date(date);
        var a = date.split('/');
        console.log("date", a, new Date(a[2], a[1]-1, a[0]))
        return new Date(a[2], a[1]-1, a[0]);
    } else if (date.indexOf(".") >= 0) {
        var a = date.split('.');
        return new Date(a[2], a[1]-1, a[0]);
    } else {
        console.log("Date error", date);
        return new Date();
    }
}

function parseTiliparserValue(value) {
    if (value)
        return +value.replace(',', '.');
    else
        return null;
}

function buildTiliparserSections(data) {
    var sections = {};
    function addItemToItsSection(i) {
        if (!sections[i.section]) {
            sections[i.section] = new TiliparserSection(i.section);
        }
        sections[i.section].addItem(i);
    }

    var parser = getParser(data);
    var rows = parser.getRows(data);

    var items = rows.map(function (r) {
        return new TiliparserItem(r, parser);
    }).filter(i => i.isValid());
    console.log(`${ items.length } lines out of ${ rows.length } were parsed as valid transaction lines`);

    items.forEach(addItemToItsSection);

    return Object.keys(sections).sort().map(sKey => {
        return sections[sKey];
    });
}

class TiliparserItem {
    constructor(row, parser) {
        var items = parser.getItems(row);
        this.date = parseTiliparserDate(items[parser.dateIndex]);
        this.sum = parseTiliparserValue(items[parser.valueIndex]);
        this.other = (items[parser.otherIndex] || items[parser.otherFallbackIndex] || '').toLowerCase();
        this.month = this.date.getMonth() + 1;
        this.year = this.date.getFullYear();
        this.section = `${ this.year }-${ ('0'+this.month).slice(-2) }`;
    }
    isValid() {
        if (isNaN(this.date)) return false;
        if (!this.sum) return false;
        if (!this.other || this.other.length == 0) return false;
        return true;
    }
}

class TiliparserSection {
    constructor(name) {
        this.name = name;
        this.items = [];
        this.positiveItems = [];
        this.negativeItems = [];
        this.sum = 0;
        this.numberOfSections = 1;
        this.otherCounts = {}; // Source or destination of money
        this.otherGainSums = {};
        this.otherSpendSums = {};
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
            this.otherGainSums[i.other] = 0;
            this.otherSpendSums[i.other] = 0;
        }
        this.otherCounts[i.other] = (this.otherCounts[i.other] || 0) + 1;
        if (i.sum > 0)
            this.otherGainSums[i.other] = (this.otherGainSums[i.other] || 0) + i.sum;
        else
            this.otherSpendSums[i.other] = (this.otherSpendSums[i.other] || 0) + i.sum;
    }
    makeAverageSection(numberOfSections) {
        this.numberOfSections = numberOfSections;
    }
    _formatSum(sum) {
        sum = sum / this.numberOfSections;
        return sum.toFixed(2);
    }
    _formatCount(count) {
        count = count / this.numberOfSections;
        return Math.round(count * 10) / 10;
    }
    getGains() {
        return {
            name: 'Gains',
            sum: this._formatSum(this.positiveItems.reduce((prev, curr) => prev + curr.sum, 0)),
            count: this._formatCount(this.positiveItems.length)
        }
    }
    getSpends() {
        return {
            name: 'Spends',
            sum: this._formatSum(this.negativeItems.reduce((prev, curr) => prev + curr.sum, 0)),
            count: this._formatCount(this.negativeItems.length)
        }
    }
    getTotals() {
        return {
            name: 'TOTAL',
            sum: this._formatSum(this.sum),
            count: this._formatCount(this.items.length)
        }
    }
    _getTopData(data, formatFunction, reverse) {
        var multiplier = reverse ? -1 : 1;
        return Object.keys(data).sort((a, b) => {
            return multiplier * (data[b] - data[a]);
        }).map(key => {
            return {
                key,
                value: formatFunction.call(this, data[key])
            }
        });
    }
    getTopCounts() {
        return this._getTopData(this.otherCounts, this._formatCount);
    }
    getTopGains() {
        return this._getTopData(this.otherGainSums, this._formatSum).filter(data => data.value > 0);
    }
    getTopSpends() {
        return this._getTopData(this.otherSpendSums, this._formatSum, 'reverse').filter(data => data.value < 0);
    }
    print(detailed) {
        var self = this;

        function printValues({name, sum, count}) {
            console.log(`  ${ name }: ${ sum } e (${ count })`);
        }
        function printTopData(description, data) {
            data = data.map(d => {
                if (detailed)
                    return `         ${ d.key } (${ d.value })`;
                else
                    return `${ d.key } (${ d.value })`;
            }).join(topDataDelimiter);

            if (detailed)
                console.log(`  ${ description }:\n${ data }`);
            else
                console.log(`  ${ description }: ${ data }`);
        }

        var topCountCount = detailed ? 5 : 3;
        var topSumCount = detailed ? 10 : 3;
        var topDataDelimiter = detailed ? '\n' : ', ';

        console.log();
        console.log(this.name);

        printValues(this.getGains());
        printValues(this.getSpends());
        printValues(this.getTotals());

        printTopData('Most transactions with', this.getTopCounts().slice(0, topCountCount));
        printTopData('Most gained from', this.getTopGains().slice(0, topSumCount));
        printTopData('Most spent to', this.getTopSpends().slice(0, topSumCount));
    }
}
