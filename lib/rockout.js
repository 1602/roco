var roco;
var cp = require('child_process');
var coffee = require('coffee-script');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var util = require('util');
var about = {};
var beforeTask = {};
var afterTask = {};
var existsSync = fs.existsSync || path.existsSync;

/**
 * Print arguments to stdout using util.puts
 */
function log() {
    roco.log.apply(this, [].slice.call(arguments));
};

function print() {
    roco.print.apply(this, [].slice.call(arguments));
};

/**
 * Initialize module. Creates module-wide global variable called `roco`
 */
exports.init = function (env) {
    return roco = new Roco(env);
};

/**
 * Perform some command.
 *
 * @param {Array} what
 * [0] {String} env - environment (optional)
 * [1] {String} command
 */
exports.perform = function (cmd) {
    var env = roco.env;

    log('Running in', $(env).bold, 'mode');

    if (roco[cmd]) {
        roco[cmd]();
    } else if (roco[cmd + ':default']) {
        roco[cmd + ':default']();
    } else {
        roco.abort('Unknown command ' + cmd);
    }
};

exports.list = function listTasks(how, noDescriptions) {
    Object.keys(about).forEach(function (ns) {
        console.log('\n' + ns + '\n');
        about[ns].forEach(function (cmd) {
            if (noDescriptions || !cmd.description) {
                console.log(' roco', ns + ':' + cmd.name);
            } else {
                console.log(' roco', ns + ':' + cmd.name, '-', cmd.description);
            }
        });
    });
};

/**
 * Roco API object, this is context-object for running rocofiles
 *
 * Every rocofile changes context of this object.
 */
function Roco(env) {
    roco = this;
    roco.env = env;
    roco.roco = this;
    this.init();
}

/**
 * Initialize roco object with some settings:
 *
 *  - ./package.json
 *  - /etc/roco.coffee
 *  - ~/.roco.coffee
 *  - ./Roco.coffee
 *  - ./config/Roco.coffee
 *
 * Package descriptor `./package.json` can provide information about:
 *
 *  - application name (`application` var set up from package.name)
 *  - git url (`repository` set from package.repository.url)
 */
Roco.prototype.init = function () {
    var cwd = process.cwd();
    var packageFile = path.resolve(cwd, 'package.json');
    var configFiles = [
        '/etc/roco.coffee',
        path.resolve(process.env.HOME, '.roco.coffee'),
        path.resolve(cwd, 'Roco.coffee'),
        path.resolve(cwd, 'config/Roco.coffee')
    ];
    var cockOutDir = path.resolve(__dirname, '../cockout');

    this.require = require;
    this.console = console;
    this.process = process;

    if (process.env.HOSTS) {
        roco.hosts = process.env.HOSTS.split(',');
    }

    if (existsSync(packageFile)) {
        var package = require(packageFile);
        this.application = package.name;
        if (package.repository) {
            roco.scm = package.repository.type;
            roco.repository = package.repository.url;
        }
    }

    if (process.env.APP) {
        roco.application = process.env.APP;
    }

    fs.readdirSync(cockOutDir).forEach(function (file) {
        if (file.match(/\.coffee$/)) {
            roco.load(path.resolve(cockOutDir, file));
        }
    });

    configFiles.forEach(function (configFile) {
        if (existsSync(path.resolve(configFile))) {
            roco.load(configFile);
        }
    });
};

Roco.prototype.log = function () {
    util.puts([].join.call(arguments, ' '));
};

Roco.prototype.print = function () {
    util.print([].join.call(arguments, ' '));
};

/**
 * Run command on all remote hosts listed in `hosts` var.
 *
 * Each host can be 'hostname' or 'hostname:portnumber'. Example:
 *
 *     HOSTS jsdoc.info:222,node-js.ru:2222 roco i:free
 */
Roco.prototype.run = function (cmd, callback) {
    if (typeof roco.hosts === 'string') {
        roco.hosts = [roco.hosts];
    }
    log('Executing ' + $(cmd).yellow + ' on ' + $(roco.hosts.join(', ')).blue);
    var wait = 0;
    data = [];

    if (roco.hosts.length > 1) {
        roco.parallelRunning = true;
    }

    roco.hosts.forEach(function (host) {
        wait += 1;
        var options = [];
        if (host.match(/:\d+$/)) {
            var h = host.split(':');
            options.push(h[0]);
            options.push('-p' + h[1]);
        } else {
            options.push(host);
        }
        if (cmd[0] === '@') {
            options.ignoreError = true;
            cmd = cmd.substr(1);
        }
        options.push(cmd);
        spawnProcess('ssh', options, function (err, out) {
            if (!err) {
                data.push({
                    host: host,
                    out: out
                });
            }
            done(err);
        });
    });

    var error;
    function done(err) {
        error = error || err;
        if (--wait === 0) {
            roco.parallelRunning = false;
            if (error) {
                roco.abort('FAILED TO RUN, return code: ' + error);
            } else if (callback) {
                callback(data);
            }
        }
    }

};

/**
 * Run command locally
 */
Roco.prototype.localRun = function (cmd, callback) {
    log('Executing ' + $(cmd).green + ' locally');
    spawnProcess('sh', [ '-c', cmd ], function (err, data) {
        if (err) {
            roco.abort('FAILED TO RUN, return code: ' + err);
        } else {
            if (callback) callback(data);
        }
    });
};

/**
 * Spawn process with `command` and `options`, call `callback` when process
 * finishes. Callback called with (code, output). Code 0 means ok, output contain
 * both `stderr` and `stdout`.
 */
function spawnProcess(command, options, callback) {
    var child = cp.spawn(command, options), waiting = true;
    var prefix = roco.parallelRunning && command === 'ssh' ? '[' + options[0] + '] ' : '';
    prefix = $(prefix).grey;

    child.stderr.on('data', function (chunk) {
        print(addBeauty(chunk));
    });
    var res = [];
    child.stdout.on('data', function (chunk) {
        res.push(chunk.toString());
        print(addBeauty(chunk));
    });

    function addBeauty(buf) {
        return prefix + buf
            .toString()
            //.replace(/\s+$/, ' ')
            .replace(/\n/g, '\n' + prefix);
    }

    if (options.ignoreError) {
        child.stdout.on('end', function() {
            if (waiting) {
                callback(null, res.join('\n'));
                waiting = false;
            }
        });
        setTimeout(function() {
            if (waiting) {
                waiting = false;
                callback(null, res.join('\n'));
            }
        }, 5000);
    } else {
        child.on('exit', function (code) {
            if (callback) {
                callback(code === 0 ? null : code, res && res.join('\n'));
            }
        });
    }
}

/**
 * Define `key` only if it is not defined yet
 *
 * @param {String} key
 * @param {Mixed} def
 */
Roco.prototype.ensure = function (key, def) {
    if (roco.hasOwnProperty(key)) return;
    roco.set(key, def);
};

/**
 * Define `key` on current roco object. When def is function, it called each time
 * when roco[key] getter called. This is odd befavior. It should be called only
 * once and then return cached value.
 *
 * TODO: only call `def` once
 *
 * @param {String} key
 * @param {Mixed} def
 */
Roco.prototype.set = function (key, def) {
    if (typeof def === 'function') {
        roco.__defineGetter__(key, def);
    } else {
        roco.__defineGetter__(key, function () {
            return def;
        });
    }
};

/**
 * Load rocofile `file`
 *
 * @param {String} file - path to rocofile
 */
Roco.prototype.load = function (file) {
    if (!file) throw new Error('File not specified');
    if (!existsSync(file)) return;
    // console.log('loading', file);
    var code = coffee.compile(fs.readFileSync(file).toString());
    var dir = path.dirname(file);
    var fn = new Function('roco', '__dirname', 'with(roco){(function(){ ' + code + ' })();}');
    fn(this, dir);
};

/**
 * Exit with status 1 and error message `msg`
 *
 * @param {String} msg
 */
Roco.prototype.abort = function (msg) {
    log($(msg).red);
    process.exit(1);
};

/**
 * Define namespace. No namespace nesting!
 */
Roco.prototype.namespace = function (name, callback) {
    if (roco.ns) {
        throw new Error('Nested namespaces is not supported at the mo');
    }
    roco.ns = name;
    callback();
    roco.ns = '';
};

/**
 * Run tasks listed as arguments sequentially
 */
Roco.prototype.sequence = function () {
    var args = arguments;
    var ns = args.callee.caller.ns;
    roco.asyncLoop([].slice.call(args), function (arg, next) {
        if (typeof arg === 'function') {
            arg.call(roco, next);
        } else {
            roco[ns ? ns + ':' + arg : arg].call(roco, next);
        }
    });
};

/**
 * Loop asyncronouslythrough `collection` calling `iteration` for each item
 * and then call `complete` (when done)
 */
Roco.prototype.asyncLoop = function asyncLoop(collection, iteration, complete) {
    var self = this;
    var item = collection.shift();
    if (item) {
        iteration.call(self, item, function next() {
            asyncLoop.call(self, collection, iteration, complete);
        });
    } else if (typeof complete === 'function') {
        complete.call(self);
    }
};

var description = '';
Roco.prototype.desc = function (text) {
    description = text;
};

/**
 * Describe task
 *
 * @param {String} name
 * @param {Function} action
 */
Roco.prototype.task = function (name, action) {
    var ns = roco.ns;
    var fullname = ns + ':' + name;
    roco[fullname] = function task(done) {
        var displayName = name === 'default' ? ns : fullname;
        log('Executing', displayName);
        var queue = [];
        if (beforeTask[fullname]) {
            queue = queue.concat(beforeTask[fullname]);
        }
        queue.push(function (next) {
            var time = Date.now();
            action(function () {
                if (next) next();
            });
        });
        if (afterTask[fullname]) {
            queue = queue.concat(afterTask[fullname]);
        }
        if (done) queue.push(done);
        roco.sequence.apply(roco, queue);
    };
    action.ns = ns;
    action.task = name;

    about[ns] = about[ns] || [];
    about[ns].push({
        name: name,
        description: description
    });
    description = '';
};

Roco.prototype.before = function (name, action) {
    beforeTask[name] = beforeTask[name] || [];
    beforeTask[name].push(action);
};

Roco.prototype.after = function (name, action) {
    afterTask[name] = afterTask[name] || [];
    afterTask[name].push(action);
};

/**
 * Stylize a string
 */
function stylize(str, style) {
    var styles = {
        'bold'      : [1,  22],
        'italic'    : [3,  23],
        'underline' : [4,  24],
        'cyan'      : [96, 39],
        'blue'      : [34, 39],
        'yellow'    : [33, 39],
        'green'     : [32, 39],
        'red'       : [31, 39],
        'grey'      : [90, 39],
        'green-hi'  : [92, 32],
    };
    return '\033[' + styles[style][0] + 'm' + str +
           '\033[' + styles[style][1] + 'm';
};

/**
 * Stylize string chainable helper, allows to call stylize like that:
 *
 *    $('some string').bold.yellow
 *
 */
function $(str) {
    str = new(String)(str);

    ['bold', 'grey', 'yellow', 'red', 'green', 'cyan', 'blue', 'italic', 'underline'].forEach(function (style) {
        Object.defineProperty(str, style, {
            get: function () {
                return $(stylize(this, style));
            }
        });
    });
    return str;
};
stylize.$ = $;
