if (!process.env.TRAVIS) {
    var semicov = require('semicov');
    semicov.init('lib'); process.on('exit', semicov.report);
}
var rockout = require('../lib/rockout');
var roco;

exports['init'] = function (test) {
    roco = rockout.init();
    test.equal(roco.constructor.name, 'Roco');
    test.done();
};

exports['perform non-existant task'] = function (test) {
    var abort = roco.abort;
    roco.abort = function (msg) {
        test.ok(msg.match('Unknown command test'));
        roco.abort = abort;
        test.done();
    };
    rockout.perform('test');
};

exports['define and perform task'] = function (test) {
    roco.ns = 'ns';
    roco.task('test', function () {
        test.done();
    });
    roco.env = 'staging';
    rockout.perform('ns:test');
};

exports['run command on remote server and locally'] = function (test) {
    test.expect(3);
    var cp = require('child_process');
    var spawn = cp.spawn;
    roco.ns = 'test';
    roco.set('hosts', ['some.host', 'another.host']);
    roco.task('default', function () {
        roco.run('cmd remote', function () {
            roco.localRun('cmd local', function () {
                cp.spawn = spawn;
                process.nextTick(test.done);
            });
        });
    });
    var cmdStack = ['sh', 'ssh', 'ssh'];
    cp.spawn = function (cmd, opts) {
        test.equal(cmd, cmdStack.pop());
        var proc = new process.EventEmitter;
        proc.stderr = proc.stdout = proc;
        process.nextTick(function () {
            proc.emit('exit', 0);
        });
        return proc;
    };
    rockout.perform('test');
};

exports['print list of commands'] = function (test) {
    rockout.list();
    test.done();
};

