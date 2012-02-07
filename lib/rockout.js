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
    var cmd = what[0];
    if (roco[cmd]) {
        roco[cmd]();
    } else if (roco[cmd + ':default']) {
        roco[cmd + ':default']();
    } else {
        roco.abort('Unknown commad', cmd);
    }
};

function Roco() {
    roco = this;
    roco.host = 'node-js.ru';
    roco.__defineGetter__('roco', function () { return roco; });
    Object.keys(Roco.prototype).forEach(function (method) {
        roco[method] = Roco.prototype[method];
    });
    this.init();
}

Roco.prototype.run = function (cmd, callback) {
    log('Executing ' + cmd);
    var destin = this.host;
    if (this.user) destin = this.user + '@' + destin;
    var ssh = cp.spawn('ssh', [ destin, cmd ]);
    ssh.stderr.on('data', function (chunk) {
        log(chunk.toString());
    });
    var res = [];
    ssh.stdout.on('data', function (chunk) {
        res.push(chunk.toString());
        log(chunk);
    });
    ssh.on('exit', function (code) {
        if (code === 0) {
            if (callback) callback(res.join('\n'));
        } else {
            roco.abort('FAILED TO RUN, return code ', code);
        }
    });
};

Roco.prototype.localRun = function (cmd, callback) {
    log('Executing ' + cmd);
    var destin = this.host;
    if (this.user) destin = this.user + '@' + destin;
    var ssh = cp.spawn('sh', [ '-c', cmd ]);
    ssh.stderr.on('data', function (chunk) {
        // log(chunk.toString());
    });
    var res = [];
    ssh.stdout.on('data', function (chunk) {
        res.push(chunk.toString());
        // log(chunk.toString());
    });
    ssh.on('exit', function (code) {
        if (code === 0) {
            if (callback) callback(res.join('\n'));
        } else {
            roco.abort('FAILED TO RUN, return code ', code);
        }
    });
};

Roco.prototype.init = function () {
    var cwd = process.cwd();
    var packageFile = path.resolve(cwd, 'package.json');
    var configFile = path.resolve(cwd, 'config/Roco.coffee');
    var cockOutDir = path.resolve(__dirname, '../cockout');

    this.require = require;
    this.console = console;

    if (path.existsSync(packageFile)) {
        var package = require(packageFile);
        this.application = package.name;
        if (package.repository) {
            roco.scm = package.repository.type;
            roco.repository = package.repository.url;
        }
    }

    fs.readdirSync(cockOutDir).forEach(function (file) {
        if (file.match(/\.coffee$/)) {
            roco.load(path.resolve(cockOutDir, file));
        }
    });

    if (path.existsSync(configFile)) {
        roco.load(configFile);
    }

};

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
            log('Done', displayName, 'in ' + (Date.now() - time) + 'ms');
            if (done) done();
        });
    };
    action.ns = ns;
    action.task = name;
};

