var el = redom.el;
var list = redom.list;
var mount = redom.mount;
var setChildren = redom.setChildren;


var tiliparserElement;
function buildTiliparserVisualization(tiliData) {
    if (!tiliparserElement) {
        tiliparserElement = new UITiliparser;
        mount(output, tiliparserElement);
    }

    tiliparserElement.update(tiliData);
}

class UITiliparser {
    constructor() {
        this.el = el('div',
            this.totalSection = new UISection(true),
            this.averageSection = new UISection(true),
            el('div.sectionSeparator', 'Monthly - most recent first'),
            this.monthlyList = list('div', UISection)
        );
    }
    update(tiliData) {
        this.monthlyList.update(tiliData.sections.reverse());
        this.averageSection.update(tiliData.averageSection);
        this.totalSection.update(tiliData.totalSection);
    }
}

class UISection {
    constructor(detailed) {
        this.el = el('div.section' + (detailed ? '.detailed' : ''),
            this.name = el('div.sectionName'),
            this.left = el('div.leftSide',
                this.gains = new UISumData,
                this.spends = new UISumData,
                this.total = new UISumData
            ),
            this.right = el('div.rightSide',
                this.topGains = new UITopData('Most gained from', detailed),
                this.topSpends = new UITopData('Most spent to', detailed),
                this.topTransactions = new UITopData('Most transactions with', detailed)
            )
        );
    }
    update(section) {
        if (!section) {
            this.el.style.display = 'none';
            return;
        }
        this.el.style.display = '';

        this.name.textContent = section.name;
        this.gains.update(section.getGains());
        this.spends.update(section.getSpends());
        this.total.update(section.getTotals());
        this.topTransactions.update(section.getTopCounts().slice(0, this.maxTopCount));
        this.topGains.update(section.getTopGains().slice(0, this.maxTopCount));
        this.topSpends.update(section.getTopSpends().slice(0, this.maxTopCount));
    }
}

class UISumData {
    constructor() {
        this.el = el('div.sumData',
            this.name = el('b'),
            ': ',
            this.value = el('span.sumValue.mainValue'),
            this.count = el('span.sumCount.secondaryInformation')
        );
    }
    update(data) {
        this.name.textContent = data.name;
        this.value.textContent = data.sum + ' €';
        this.count.textContent = '(' + data.count + ')';
    }
}

class UITopData {
    constructor(nameText, detailed) {
        this.isDetailed = detailed;
        this.el = el('div.topData',
            this.name = el('b', nameText),
            this.seeMore = el('span.seeMoreButton.secondaryInformation', 'see more'),
            this.list = list('div', UITopDataItem)
        );

        var self = this;
        this.seeMore.onclick = function() {
            alert(self.fullData);
        };
    }
    update(data) {
        this.data = data;
        this.fullData = data.map(d => d.value + '\t' + d.key).join('\n');
        this.name.setAttribute('title', this.fullData);

        var slicedData = data.slice(0, this.isDetailed ? 10 : 5);
        this.list.update(slicedData);
    }
}

class UITopDataItem {
    constructor() {
        this.el = el('div',
            this.name = el('span.topDataKey.secondaryInformation'),
            this.value = el('span.topDataValue.mainValue')
        )
    }
    update(data) {
        this.name.textContent = data.key;
        this.value.textContent = data.value;
    }
}
