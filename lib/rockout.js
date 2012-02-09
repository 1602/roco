var roco;
var cp = require('child_process');
var coffee = require('coffee-script');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var log = console.log;

exports.init = function () {
    roco = new Roco;
};

exports.perform = function (what) {
    var env = what[0];
    var cmd = what[1];

    // check whether env param omitted
    if (roco[env] || roco[env + ':default']) {
        cmd = env;
        env = 'production';
    }

    console.log('Running in', env, 'mode');
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
    log('Executing ' + cmd + ' on ' + roco.hosts.join(', '));
    var wait = 0;
    data = [];
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
            if (error) {
                roco.abort('FAILED TO RUN, return code: ' + error);
            } else if (callback) {
                callback(data);
            }
        }
    }

};

Roco.prototype.localRun = function (cmd, callback) {
    log('Executing ' + cmd + ' locally');
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
    var prefix = command === 'ssh' ? ' [' + options[0] + '] ' : '';
    
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
    log(msg);
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

