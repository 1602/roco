
var VM = require('vm');

module.exports = {
    create: RocoContext
};

function RocoContext (obj) {
    var ctx = VM.createContext(obj);

    /**
     * Define `key` only if it is not defined yet
     *
     * @param {String} key
     * @param {Mixed} def
     */
    ctx.ensure = function (key, def) {
        // probably we need to deny rewriting ensure/set keys
        if (ctx.hasOwnProperty(key)) return;
        ctx.set(key, def);
    };

    /**
     * Define `key` on current RocoContext object. When def is function, it called once
     * when roco[key] getter called.
     *
     * @param {String} key
     * @param {Mixed} def
     */
    ctx.set = function (key, def) {
        var setter = function (val) {
                def = (typeof val === 'function')? val() : val;
                return def;
            },
            getter = function () {
                return setter(def);
            };

        Object.defineProperty(ctx, key, { get: getter, configurable: true });
    };

    return ctx;
}
