
const EXEC = require("child_process").exec;
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const SM_STATUS = require("./status");
const CORE = require("../core");


exports.main = function(pm, options) {

    var done = Q.ref();

    // TODO: Indent everything 4 spaces.

    TERM.stdout.writenl("");

    done = Q.when(done, getUname).then(function(uname) {
        TERM.stdout.writenl("\0white(\0bold(`" + uname[0] +"`: " + "\0)" + uname[1] + "\0)");
    });    
    done = Q.when(done, getSmVersion).then(function(version) {
        TERM.stdout.writenl("\0white(\0bold(`" + version[0] +"`: " + "\0)" + version[1] + "\0)");
    });
    done = Q.when(done, getNpmVersion).then(function(version) {
        TERM.stdout.writenl("\0white(\0bold(`" + version[0] +"`: " + "\0)" + version[1] + "\0)");
    });

    done = Q.when(done, getNpmVersion).then(function(version) {
        TERM.stdout.writenl("\0white(\0bold(" + "process.version" +": " + "\0)" + process.version + "\0)");
        TERM.stdout.writenl("\0white(\0bold(" + "process.arch" +": " + "\0)" + process.arch + "\0)");
        TERM.stdout.writenl("\0white(\0bold(" + "process.platform" +": " + "\0)" + process.platform + "\0)");
    });

    return Q.when(done, function() {

        TERM.stdout.writenl("\0white(\0bold(" + "`sm status`: " + "\0)\0)");

        var opts = UTIL.copy(options);
        opts.all = true;
        return CORE.getStatusTree(pm, opts).then(function(statusTree) {

            return SM_STATUS.printTree(statusTree, opts);

        });
    });
}


function getSmVersion() {
    var deferred = Q.defer();
    var command = "sm --version";
    EXEC(command, function(error, stdout, stderr) {
        if (error) {
            console.error(stderr);
            return deferred.reject(new Error("Error calling command: " + command));
        }
        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
    });
    return deferred.promise;
}

function getNpmVersion() {
    var deferred = Q.defer();
    var command = "npm --version";
    EXEC(command, function(error, stdout, stderr) {
        if (error || stderr) {
            console.error(stderr);
            return deferred.reject(new Error("Error calling command: " + command));
        }
        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
    });
    return deferred.promise;
}

function getUname() {
    var deferred = Q.defer();
    var command = "uname -a";
    EXEC(command, function(error, stdout, stderr) {
        if (error || stderr) {
            console.error(stderr);
            return deferred.reject(new Error("Error calling command: " + command));
        }
        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
    });
    return deferred.promise;
}
