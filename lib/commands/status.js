
const ASSERT = require("assert");


exports.main = function(pm, options) {

    ASSERT(typeof options.pm !== "undefined", "'options.pm' required!");

    return require("sourcemint-pm-" + options.pm + "/lib/pm").status(pm, options);
}
