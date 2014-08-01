
var ASSERT = require('assert'),
    UTIL = require('util'),

    U = require('../utils');

// log middleware
module.exports = function (roco, ctx) {

    /**
     * Synchronously load rocofile `file`
     * @param {String} logString - path to rocofile
     */
    ctx.log = function (logString) {
        ASSERT(log, 'log string not specified');
        roco.emit('info', UTIL.format(logString, U.slice(arguments, 1)));
    };

    /**
     * Synchronously load rocofile `file`
     * @param {String} logString - path to rocofile
     */
    ctx.abort = function (errString) {
        ASSERT(errString, 'error not specified');
        throw new Error(UTIL.format(errString, U.slice(arguments, 1)));
    };

};
