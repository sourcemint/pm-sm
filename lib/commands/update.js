
const INSTALL = require("./install");


exports.main = function(pm, options) {

    options.update = true;

    return INSTALL.main(pm, options);
}
