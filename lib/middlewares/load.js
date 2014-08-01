
var FS = require('fs'),
    PATH = require('path'),
    ASSERT = require('assert'),
    U = require('../utils');

// load middleware
module.exports = function (roco, ctx) {

    /**
     * Synchronously load rocofile `file`
     * @param {String} file - path to rocofile
     */
    ctx.load = function (file) {
        ASSERT(file, 'File not specified');
        if (!FS.existsSync(file)) return;

        U.runCoffeeInContext(FS.readFileSync(file).toString(), this, file);
    };

};
