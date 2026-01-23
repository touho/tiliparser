
function init() {
}

function readFileContent(callback) {
    if (input.files.length == 0) return null;

    var reader = new FileReader();
    reader.readAsText(input.files[0]);
    reader.onload = function(e) {
        callback(e.target.result);
    }
}

function readInput() {

    function fail() {
        var failNode = redom.el('div.invalidFileError', 'Invalid file');
        input.parentNode.insertBefore(failNode, input.nextSibling);
        setTimeout(() => {
            failNode.parentNode.removeChild(failNode);
        }, 1000);
    }

    readFileContent(function(content) {
        if (!content) return fail();

        var tiliData = tiliparser.build(content);

        if (!tiliData) return fail();

        intro.style.display = 'none';

        tiliparser.print(tiliData);
        console.log('tiliData', tiliData);
        window.tiliData = tiliData;

        buildTiliparserVisualization(tiliData);

    });
}
