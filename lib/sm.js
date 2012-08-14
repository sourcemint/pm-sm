
const ASSERT = require("assert");
const PATH = require("path");
const PM = require("./pm");


exports.for = function(packagePath) {
    return new SM(packagePath);
}


var SM = function(packagePath) {
    this.packagePath = packagePath;
}

SM.prototype.require = function(locator, callback) {
	var self = this;

	try {

		ASSERT(typeof locator === "object", "`locator` is not an object");
		ASSERT(typeof locator.location === "string", "`locator.location` is not a string");
		ASSERT(typeof locator.pm === "string", "`locator.pm` is not a string");

	} catch(err) {
		callback(err);
		return;
	}

	var packageURI = locator.location.replace(/\//g, "+");

    PM.forProgramPath(self.packagePath).then(function(pm) {
        return PM.forPackagePath(self.packagePath, pm).then(function(pm) {

			var mappings = {};
			mappings[packageURI] = [
				// Discover PM by downloading package and looking at `package.json ~ pm`.
				locator.pm,
				locator.location
			];

	        return pm.install({
	        	latest: false,
	        	verbose: false,
	        	// TODO: Implement `quiet`.
	        	quiet: true,
	        	descriptorOverlay: {
	        		mappings: mappings
	        	}
	        });
        });
    }).then(function(manifest) {
    	if (!manifest[packageURI]) {
    		throw new Error("Unable to find dependency package with alias '" + packageURI + "' in package '" + self.packagePath + "'!");
    	}

    	if (typeof locator.module !== "undefined") {
			callback(null, require(PATH.join(manifest[packageURI].path, manifest[packageURI].libDir, locator.module)));
    	}
    	else {
    		// TODO: Return `main` module if declared.
			callback(null, null);
    	}

    }).fail(callback);
}
