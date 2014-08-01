
var ASSERT = require('assert'),
    UTIL = require('util'),
    EventEmitter = require('events').EventEmitter,

    VOW = require('vow'),
    $ = require('chalk'),

    createRocoContext = require('./context').create,
    U = require('./utils');

module.exports = Roco;

// default values for non-passed properties
var defaults = {
    environment: 'development',
    application: '',
    cockOutPath: __dirname + '/../cockout/*.coffee',
    configFiles: ['/etc/roco.coffee', '~/.roco.coffee', './Roco.coffee', './config/Roco.coffee'],
    packageFile: 'package.json',

    /**
     * Initializes some default properties like application, scm, repository
     * @param {Object} ctx - V8 context (sandbox)
     * @param {*} package - package file content
     */
    packageHandler: function (ctx, package) {
        // set default application
        if (package.name) {
            ctx.application = package.name;
        }
        // set scm and repository
        if (package.repository) {
            ctx.scm = package.repository.type;
            ctx.repository = package.repository.url;
        }
    }
};

/**
 * Roco API object, this is context-object for running rocofiles
 *
 * @param {{env: String, cwd: String, hosts: String|String[], packageFile: String, configFiles: String|Array}} opts
 * Every rocofile changes context of this object.
 */
function Roco (opts) {
    EventEmitter.call(this);

    ASSERT.equal(typeof opts, 'object', 'opts should be an object');
    ASSERT.equal(typeof opts.env, 'string', 'opts.env should be a string');

    ASSERT(opts.cwd, 'opts.cwd should be passed');
    ASSERT(opts.home, 'opts.home should be passed');
    ASSERT(opts.hosts, 'opts.hosts should be passed');

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

    // why ../cockout ?
    var cockOutPath = opts.cockOutPath || defaults.cockOutPath,
        packageHandler = opts.packageHandler || defaults.packageHandler;

    // create sandbox
    var ctx = this.ctx = createRocoContext({
        env: opts.env || defaults.environment,
        roco: this,
        application: opts.app || defaults.application,
        hosts: opts.hosts,
        // helpers
        require: require,
        console: console,
        process: process
    });
    var roco = this;

    // use some standard helpers
    this.use(require('./middlewares/tasks'));
    this.use(require('./middlewares/run'));
    this.use(require('./middlewares/load'));
    this.use(require('./middlewares/log'));

    /*
    var originalEmit = this.emit;
    this.emit = function () {
          console.log.apply(console, arguments);
          originalEmit.apply(this, arguments);
    };*/

    // preload config files data
    VOW.allResolved({
        packageFile: U.lookUpAndRead(opts.cwd, opts.packageFile || defaults.packageFile),
        cockOutFiles: U.readFiles(U.glob(cockOutPath, {cwd: opts.cwd})),
        configFiles: U.readFiles(U.resolveFileNames(opts, opts.configFiles || defaults.configFiles))
    })
        .then(function (d) {

            if (d.packageFile.isFulfilled()) {
                packageHandler(ctx, d.packageFile.valueOf());
            }

            var cockouts = d.cockOutFiles.valueOf() || [];
            var configs = d.configFiles.valueOf() || [];

            cockouts.concat(configs)
                .forEach(function (f) {
                    U.runCoffeeInContext(f.content, ctx, f.path);
                });

            roco.emit('ready', roco);
        })
        .fail(function (err) {
            roco.emit('error', err);
        });
}

UTIL.inherits(Roco, EventEmitter);

/**
 * @param {function (Object, Object)} module
 */
Roco.prototype.use = function (module) {
    module(this, this.ctx);
};

/**
 * Initialize module instance
 * @param {Object} opts
 */
Roco.create = function create (opts) {
    var roco = new Roco(opts);

    roco.create = create;

    // tasks collector
    var about = {};
    roco.on('task declaration',
        /**
         * @param {{name: String, ns: String, task: String, opts: Object}} action
         */
        function (action) {
            var ns = action.ns;
            about[ns] = about[ns] || [];
            about[ns].push(action);
        });

    roco.on('run', function (meta) {
        log({stars: 1}, 'executing ' + $.yellow('%j'), meta.cmd);
        log('servers: ' + $.bold.blue('%j'), meta.hosts);
    });
    roco.on('run start', function (meta) {
        log({prefix: meta.host}, 'executing command');
        pipe(meta.stdout, process.stdout, {host: meta.host, stars: 2, streamTag: 'out'});
        pipe(meta.stderr, process.stdout, {host: meta.host, stars: 3, streamTag: 'err'});
    });
    roco.on('run end', function (meta) {
        unpipe(meta.stdout);
        unpipe(meta.stderr);
    });

    /**
     * Perform some command.
     *
     * @param {String} cmd
     */
    roco.perform = function (cmd) {
        log('running in %s mode', $.bold(roco.ctx.env));

        var task = cmd = this.ctx[cmd]? cmd : cmd + ':default';

        if (!this.ctx[cmd]) {
            this.emit('error', new Error('Unknown task ' + task));
            return;
        }

        this.ctx[cmd]();
        return true;
    };

    /**
     * List available tasks
     * @param {What} how
     * @param {boolean} noDescription
     */
    roco.list = function listTasks (how, noDescriptions) {
        var maxWidth = Math.max.apply(null, Object.keys(about).map(function (ns) {
            return Math.max.apply(null, about[ns].map(function (action) {
                return action.displayName.length;
            }));
        }));

        Object.keys(about).forEach(function (ns) {
            print('\n' + ns + '\n');
            about[ns].forEach(function (action) {
                var paddedName = '  ' + action.displayName;
                if (noDescriptions || !action.description) {
                    print(paddedName);
                } else {
                    print(U.rpad(paddedName, maxWidth), ' ', action.description.replace(/^/gm, U.rpad('', maxWidth + 3)).replace(/^\s+/, ''));
                }
            });
        });
    };

    return roco;

    /**
     * format string
     *
     * @param {Object} [params]
     * @param {String} format
     * @param {String} [args...]
     */
    function logformat (params, format, args) {
        args = U.slice(arguments);
        params = (typeof args[0] === 'object')? args.shift() : {};
        var result = UTIL.format.apply(null, args);

        params.stars = Math.max(0, Math.min(4, params.stars || 0));
        var indent = U.rpad(U.rpad('', 4 - params.stars), 4, '*') + ' ';

        var prefixes = [$.gray(indent)];

        if (params.prefix) {
            prefixes.push($.gray('[' + params.prefix + ']') + ' ');
        }

        result = result.replace(/^([^$])/gm, prefixes.join('') + '$1');
//console.log(args, params);
        return result;
    }

    function log () {
        UTIL.puts(logformat.apply(null, arguments));
    }

    function print () {
        UTIL.print(logformat.apply(null, arguments));
    }

    function pipe (inStream, outStream, meta) {
        inStream.on('data', function (chunk) {
            meta.stars = Math.max(0, Math.min(4, meta.stars));
            var prefix = U.rpad(U.rpad('', 4 - meta.stars), 4, '*');
            chunk = String(chunk).replace(/^([^$])/gm, [
                $.gray(prefix),
                $.gray('[' + meta.host + ' :: ' + meta.streamTag + ']'),
                '$1'
            ].join(' '));
            outStream.write(chunk);
        });
    }

    function unpipe (inStream) {
        inStream.removeAllListeners();
    }
};
