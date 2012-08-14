
exports.main = function(pm, options) {

    // TODO: Install `sourcemint-deployer` on demand & remove from `../../package.json ~ dependencies`

    return require("sourcemint-deployer/lib/pm").deploy(pm, options);

}
