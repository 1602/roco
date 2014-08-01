
var CP = require('child_process');

// run middleware
module.exports = function (roco, ctx) {

    var parallelRunning = false;

    /**
     * Run command locally
     * localRun "ls -la", (done) -> sequence doSomethingElse, done;
     */
    ctx.localRun = function (cmd, callback) {
        var meta = {host: null, cmd: cmd, since: Date.now()};
        roco.emit('run', meta);
        roco.emit('run start', meta);
        spawnProcess('sh', [ '-c', cmd ], meta, function (err, data) {
            meta.error = err;
            meta.data = data;
            meta.till = Date.now();
            meta.elapsed = meta.till - meta.since;
            roco.emit('run stop', meta);
            roco.emit('run end', meta);
            if (!err && callback) {
                callback(data);
            }
        });
    };

    var children = [];
    roco.on('close', function () {
        children.forEach(function (child) {
            child.unref();
        });
    });

    /**
     * Run command on all remote hosts listed in `hosts` var.
     *
     * Each host can be 'hostname' or 'hostname:portnumber'. Example:
     *
     *     HOSTS=jsdoc.info:222,node-js.ru:2222 roco i:free
     */
    ctx.run = function (cmd, callback) {
        if (typeof ctx.hosts === 'string') {
            ctx.hosts = [ctx.hosts];
        }
        // roco.log('Executing ' + $(cmd).yellow + ' on ' + $(ctx.hosts.join(', ')).blue);
        var wait = 0;
        var data = [];

        if (ctx.hosts.length > 1) {
            parallelRunning = true;
        }

        var meta = {cmd: cmd, hosts: ctx.hosts, since: Date.now()};
        roco.emit('run', meta);

        ctx.hosts.forEach(function (host) {
            var meta = {host: host, cmd: cmd};
            wait += 1;
            var options = [];
            if (host.match(/:\d+$/)) {
                var h = host.split(':');
                options.push(h[0]);
                options.push('-p' + h[1]);
            } else {
                options.push(host);
            }
            options.push(cmd);
            spawnProcess('ssh', options, meta, function (err, out) {
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
        function done (err) {
            error = error || err;
            if (--wait) {
                return;
            }
            parallelRunning = false;

            meta.error = error;
            meta.data = data;
            meta.till = Date.now();
            meta.elapsed = meta.till - meta.since;
            roco.emit('run end', meta);

            if (!error && callback) {
                callback(data);
            }
        }

    };

    /**
     * Spawn process with `command` and `options`, call `callback` when process
     * finishes. Callback called with (code, output). Code 0 means ok, output contain
     * both `stderr` and `stdout`.
     */
    function spawnProcess (command, options, meta, callback) {
        var child = CP.spawn(command, options, {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        var childId = children.push(child) - 1;

        meta.stdout = child.stdout;
        meta.stderr = child.stderr;
        roco.emit('run start', meta);

        var res = [];
        child.stdout.on('data', function (chunk) {
            res.push(chunk.toString());
        });

        child.on('close', function (code) {
            delete children[childId];
            meta.code = code;
            roco.emit('run stop', meta);
            if (callback) {
                callback(code === 0 ? null : code, res && res.join('\n'));
            }
        });
    }
};
