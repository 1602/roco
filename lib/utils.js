
var FS = require('fs'),
    PATH = require('path'),
    VM = require('vm'),

    VOW = require('vow'),
    VOWFS = require('vow-fs'),
    COFFEE = require('coffee-script'),
    $ = require('chalk');

module.exports = {
    lookUpAndRead: vowLookUpAndRead,
    readFiles: vowReadFiles,
    resolveFileNames: resolveFileNames,
    glob: function (pattern, opts) {
        var defer = VOW.defer();
        VOWFS.glob.apply(VOWFS, arguments)
            .then(function (r) {
                defer.resolve(resolveFileNames(opts || {}, r));
            }, function (e) {
                defer.reject(e);
            });
        return defer.promise();
    },
    runCoffeeInContext: runCoffeeInContext,
    join: Function.prototype.call.bind(Array.prototype.join),
    slice: Function.prototype.call.bind(Array.prototype.slice),
    rpad: rpad
};

/**
 * Asynchronously look for a file up to the root directory and read it
 * @param {String} directory
 * @param {String} filename
 * @returns {vow:Promise}
 */
function vowLookUpAndRead (dir, filename) {
    var parts = dir.split(PATH.sep);
    var partsCount = parts.length;
    var defer = VOW.defer();

    function tryNext () {
        var tryDir = PATH.resolve(parts.join(PATH.sep) + PATH.sep);
        FS.readFile(PATH.join(tryDir, filename), {encoding: 'utf-8'}, function (err, data) {
            if (err) {
                defer.notify(Math.round((partsCount - parts.length) / partsCount) + '%');
                return parts.length? tryNext() : defer.reject(err);
            }
            defer.resolve(data);
        });
        parts.pop();
    }
    tryNext();

    return defer.promise();
}

/**
 * Try to read a list of files, skips on error
 * @param {Array|vow:Promise} vowFiles list of files to read
 * @returns {vow:Promise} Objects with path and content
 */
function vowReadFiles (vowFiles) {
    var defer = VOW.defer();

    VOW.resolve(vowFiles).then(function (files) {
        var filesData = files.map(function (v) {
            return VOWFS.read(v, 'utf-8');
        });

        VOW.allResolved(filesData).then(function (data) {
            var result = [];
            data.forEach(function (p, i) {
                if (p.isFulfilled()) {
                    result.push({path: files[i], content: p.valueOf()});
                }
            });
            defer.resolve(result);
        });
    });

    return defer.promise();
}

/**
 * @param {{home: String, cwd: String}} opts
 * @param {String|Array} filepaths
 * @returns {Array} resolved file paths
 */
function resolveFileNames (opts, filepaths) {
    filepaths = Array.isArray(filepaths)?
        filepaths : (String(filepaths).split(PATH.delimiter));

    return filepaths.map(function (v) {
            return PATH.resolve(opts.cwd, v.replace(/^~/, opts.home));
        })
        .filter(function (v) {
            return v;
        });
}

function runCoffeeInContext (code, ctx, filename) {
    ctx.__filename = filename;
    ctx.__dirname = PATH.dirname(filename);
    return VM.runInContext(COFFEE.compile(code), ctx, filename);
}

/**
 * Right pad `str` to `width`.
 *
 * @param {String} str
 * @param {Number} width
 * @return {String}
 * @api private
 */
function rpad (str, width, char) {
    var len = Math.max(0, width - str.length);
    return str + Array(len + 1).join(char || ' ');
}
