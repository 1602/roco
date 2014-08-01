
var ASSERT = require('assert');

var namespaces = [],
    beforeTask = [],
    afterTask = [],

    description,
    undef,
    slice = Function.prototype.call.bind(Array.prototype.slice);

// tasks and namespaces middleware
module.exports = function (roco, ctx) {

    /**
     * Namespace declaration
     * @param {String} name
     * @param {Function} callback
     */
    ctx.namespace = function (name, block) {
        ASSERT(typeof name === 'string', 'Invalid namespace declaration');
        ASSERT(typeof block === 'function', 'Invalid namespace declaration');

        namespaces.push(name);
        block();
        namespaces.pop();
    };

    /**
     * Task description declaration
     * Usage:
     *   desc "description"
     *   task 'sometask', ->
     *     // action
     * @param {String} desc
     */
    ctx.desc = function (desc) {
        ASSERT(typeof desc === 'string', 'Invalid desc declaration');
        description = desc;
    };

    /**
     * Task declaration
     * @param {String} name Task name
     * @param {Object} [opts] Options
     * @param {Function} action Instructions
     */
    ctx.task = function (name, opts, action) {
        if (arguments.length === 2) {
            action = opts;
            opts = {};
        }

        ASSERT(typeof name === 'string', 'Task name should be a string');
        ASSERT(typeof opts === 'object', 'Invalid task declaration');
        ASSERT(typeof action === 'function', 'Action should be a function');

        action.ns = namespacePath();
        action.opts = opts;
        action.task = namespacePath(name);
        action.shortName = name;
        action.displayName = name === 'default' ? action.ns : action.task;
        if (description) {
            action.description = description;
            description = undef;
        }

        ctx[action.task] = wrapAction(ctx, action);

        roco.emit('task declaration', action);

        /**
         * Task declaration wrapper
         * Wraps task block into calling async sequence
         * @param {Context} ctx
         * @param {Function} action
         * @returns {Function} wrapped action
         */
        function wrapAction (ctx, action) {
            var ns = action.ns;

            function taskCaller (next) {
                // var time = Date.now();
                action(function taskDone () {
                    // Date.now() - time ?
                    if (next) next();
                });
            }
            taskCaller.action = action;

            return function task (done) {
                roco.emit('task call', action);

                var queue = [].concat(
                    beforeTask[action.displayName] || [],
                    taskCaller,
                    afterTask[action.displayName] || [],
                    done
                ).filter(function (v) {
                    return v;
                });

                ctx.sequence.apply(ctx, queue);

                return queue;
            };
        }
    };

    /**
     * Before triggers declaration
     * @param {String} name
     * @param {Function} action
     */
    ctx.before = function (name, action) {
        beforeTask[name] = beforeTask[name] || [];
        beforeTask[name].push(prepareAction(action));
    };

    /**
     * After triggers declaration
     * @param {String} name
     * @param {Function} action
     */
    ctx.after = function (name, action) {
        afterTask[name] = afterTask[name] || [];
        afterTask[name].push(prepareAction(action));
    };

    /**
     * Run tasks listed as arguments sequentially
     * @param {Function} [...args]
     */
    ctx.sequence = function sequenceCall (fns) {
        fns = slice(arguments);
        var ns = arguments.callee.caller.ns;
        debugger;
        asyncLoop(fns, function sequenceIteration (arg, next) {
            if (typeof arg === 'function') {
                arg.call(ctx, next);
            } else {
                ctx[ns ? ns + ':' + arg : arg].call(ctx, next);
            }
        });
    };

    /**
     * Loop asyncronouslythrough `collection` calling `iteration` for each item
     * and then call `complete` (when done)
     */
    function asyncLoop (collection, iteration, complete) {
        var item = collection.shift();
        if (item) {
            iteration.call(ctx, item, function next () {
                asyncLoop.call(ctx, collection, iteration, complete);
            });
        } else if (typeof complete === 'function') {
            complete.call(ctx);
        }
    }

    /**
     * Get current namespace path joined by ':'
     * @param {String} [task]
     * @returns {String} full task or namespace path
     */
    function namespacePath (task) {
        var path = task? namespaces.concat([task]) : namespaces;
        return path.join(':');
    }

    /**
     * parses action name or generates calling object
     */
    function prepareAction (action) {
        if (!~action.indexOf(':')) {
            return action;
        }
        return namespacePath(action);
    }
};
