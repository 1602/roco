var roco;
var cp = require('child_process');
var coffee = require('coffee-script');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var util = require('util');
var log = function () {
    util.puts([].join.call(arguments, ' '));
};

exports.init = function () {
    roco = new Roco;
};

exports.perform = function (what) {
    var env = what[0];
    var cmd = what[1];

    // check whether env param omitted
    if (!cmd || roco[env] || roco[env + ':default']) {
        cmd = env;
        env = 'production';
    }

    log('Running in', $(env).bold, 'mode');
    roco.set('env', env);

    if (roco[cmd]) {
        roco[cmd]();
    } else if (roco[cmd + ':default']) {
        roco[cmd + ':default']();
    } else {
        roco.abort('Unknown command ' + cmd);
    }
};

function Roco() {
    roco = this;
    roco.__defineGetter__('roco', function () { return roco; });
    Object.keys(Roco.prototype).forEach(function (method) {
        roco[method] = Roco.prototype[method];
    });
    this.init();
}

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

    if (process.env.HOSTS) {
        roco.hosts = process.env.HOSTS.split(',');
    }

    if (path.existsSync(packageFile)) {
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

    configFiles.forEach(function (configFile) {
        if (path.existsSync(path.resolve(configFile))) {
            roco.load(configFile);
        }
    });

    fs.readdirSync(cockOutDir).forEach(function (file) {
        if (file.match(/\.coffee$/)) {
            roco.load(path.resolve(cockOutDir, file));
        }
    });
};

Roco.prototype.run = function (cmd, callback) {
    log('Executing ' + $(cmd).yellow + ' on ' + $(roco.hosts.join(', ')).blue);
    var wait = 0;
    data = [];

    if (roco.hosts.length > 1) {
        roco.parallelRunning = true;
    }

    roco.hosts.forEach(function (host) {
        wait += 1;
        spawnProcess('ssh', [host, cmd], function (err, out) {
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

function spawnProcess(command, options, callback) {
    var child = cp.spawn(command, options);
    var prefix = roco.parallelRunning && command === 'ssh' ? '[' + options[0] + '] ' : '';
    prefix = $(prefix).grey;
    
    child.stderr.on('data', function (chunk) {
        log(addBeauty(chunk));
    });
    var res = [];
    child.stdout.on('data', function (chunk) {
        res.push(chunk.toString());
        log(addBeauty(chunk));
    });

    function addBeauty(buf) {
        return prefix + buf
            .toString()
            .replace(/\s+$/, '')
            .replace(/\n/g, '\n' + prefix);
    }

    child.on('exit', function (code) {
        if (callback) {
            callback(code === 0 ? null : code, res && res.join('\n'));
        }
    });
}

Roco.prototype.ensure = function (key, def) {
    if (roco.hasOwnProperty(key)) return;
    roco.set(key, def);
};

Roco.prototype.set = function (key, def) {
    if (typeof def === 'function') {
        roco.__defineGetter__(key, def);
    } else {
        roco.__defineGetter__(key, function () {
            return def;
        });
    }
};

Roco.prototype.load = function (file) {
    if (!file) throw new Error('File not specified');
    var code = coffee.compile(fs.readFileSync(file).toString());
    var script = vm.createScript(code, file);
    script.runInNewContext(this);
};

Roco.prototype.abort = function (msg) {
    log($(msg).red);
    process.exit(1);
};

Roco.prototype.namespace = function (name, callback) {
    roco.ns = name;
    callback();
    roco.ns = '';
};

Roco.prototype.sequence = function () {
    var args = arguments;
    var ns = args.callee.caller.ns;
    roco.asyncLoop([].slice.call(args), function (arg, next) {
        if (typeof arg === 'function') {
            arg.call(roco, next);
        } else {
            roco[ns + ':' + arg].call(roco, next);
        }
    });
};

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

Roco.prototype.desc = function (text) {
};

Roco.prototype.task = function (name, action) {
    var ns = roco.ns;
    roco[ns + ':' + name] = function task(done) {
        var displayName = name === 'default' ? ns : ns + ':' + name;
        log('Executing', displayName);
        var time = Date.now();
        action(function () {
            if (done) done();
        });
    };
    action.ns = ns;
    action.task = name;
};

// Stylize a string
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
