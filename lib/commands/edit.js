
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var SM_PM = require("../pm");
var PACKAGES = require("sourcemint-pinf-js/lib/packages");
var URI_PARSER = require("../uri-parser");



exports.main = function(pm, options) {

    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").edit(pm, options);
    }

    return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {
        
        var found = false;

        options. all = true;
        return pm.context.program.walkPackages(options, function(parentPkg, pkgInfo, context) {
            
            if (context.circular === true) return;
            
            return SM_PM.forPackagePath(pkgInfo[0].path, pm).then(function(pm) {
                
                var path = pkgInfo[0].path;
                if (path.substring(0, pm.context.program.package.path.length) === pm.context.program.package.path) {
                    var segments = path.substring(pm.context.program.package.path.length + 1).split("/");
                    if (segments[0] === "node_modules" || segments[0] === "mapped_packages") {
                        segments.shift();
                    }
                    // Match requested DEPENDENCY (id).
                    if (segments.join("/") === options.args[0]) {
                        var mappingsUriInfo = false;
                        var mappingsType = false;
                        var npmName = false;
                        if (parentPkg.descriptor.json.mappings && parentPkg.descriptor.json.mappings[pkgInfo[2][0]]) {
                            mappingsType = parentPkg.descriptor.json.mappings[pkgInfo[2][0]][0];
                            mappingsUriInfo = URI_PARSER.parse(parentPkg.descriptor.json.mappings[pkgInfo[2][0]][1]);
                        } else
                        if (parentPkg.descriptor.json.devMappings && parentPkg.descriptor.json.devMappings[pkgInfo[2][0]]) {
                            mappingsType = parentPkg.descriptor.json.devMappings[pkgInfo[2][0]][0];
                            mappingsUriInfo = URI_PARSER.parse(parentPkg.descriptor.json.devMappings[pkgInfo[2][0]][1]);
                        }
                        if (pkgInfo[1].indexOf("dependencies") >= 0 || pkgInfo[1].indexOf("devDependencies") >= 0) {
                            mappingsType = "npm";
                            npmName = pkgInfo[2][0];
                        }

                        // NOTE: This is a hack until we have a better dependency tree parser that combines with descriptor declarations.

                        if (/\/mapped_packages\/[^\/]*$/.test(pkgInfo[0].path)) {

                            return SM_PM.forPackagePath(pkgInfo[0].path.replace(/\/mapped_packages\/([^\/]*)$/, "/node_modules/$1"), pm).then(function(pm) {                            
                                found = [pm, mappingsUriInfo, mappingsType, npmName];
                            });

                        } else {
                            found = [pm, mappingsUriInfo, mappingsType, npmName];
                        }
                    }
                }
            });
        }).then(function() {
            if (found === false) {
                TERM.stdout.writenl("\0red(Error: Could not find '\0blue(" + options.args[0] + "\0)' in dependency tree. See `sm status` for \0blue(dependency\0) ids.\0)");
                var deferred = Q.defer();
                deferred.reject();
                return deferred.reject();
            }
            options.pm = "git";
            if (found[1] && found[1].vendor) {
                options.locator = found[1].href;
                options.rev = found[1].vendor.rev || false;
            }
            var done = Q.ref();

            if (found[2] === "npm" && found[3]) {
                done = Q.when(done, function() {
                    var opts = UTIL.copy(options);
                    opts.name = found[3];
                    opts.pm = "npm";
                    opts.includeDescriptor = true;
                    return pm.status(opts).then(function(status) {
                        options.npmStatusInfo = status;
                    });
                });
            }

            return Q.when(done, function() {
                return found[0].edit(options);
            });
        });
    });
}
