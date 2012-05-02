
var ASSERT = require("assert");
var PATH = require("path");
var FS = require("fs");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var PM_NPM = require("sourcemint-pm-npm/lib/pm");
var SM_PM = require("../pm");
var URI_PARSER = require("../uri-parser");
var FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
var SPAWN = require("child_process").spawn;
var EXEC = require("child_process").exec;


exports.main = function(pm, options) {
    
    var deferred = Q.defer();

    var targetUri = options.targetUri;

    // TODO: Only allow deploy if no packages are linked in or git of linked in packages
    //       is in sync with latest published. Override this with --force.

    if (/^\.{0,2}\//.test(targetUri) && PATH.existsSync(PATH.dirname(PATH.resolve(targetUri)))) {

        var targetPath = PATH.resolve(targetUri);

        if (PATH.existsSync(targetPath)) {
            
            if (options.delete) {
                TERM.stdout.writenl("\0cyan(Deleting path '" + targetPath + "'.\0)");
                FS_RECURSIVE.rmdirSyncRecursive(targetPath);
            } else {
                TERM.stdout.writenl("\0red(" + "ERROR: " + "Target path '" + targetPath + "' already exists! Use -d to delete what is already there." + "\0)");
                deferred.reject();
                return deferred.promise;
            }
        }
        
        var packagePath = pm.context.package.path;

        FS.mkdirSync(targetPath);
        var targetSourcePath = PATH.join(targetPath, "source");
        
        // TODO: The more exact info we have available the more specific the archive name should be.
        var name = [];
        if (pm.context.package.descriptor.json.name) {
            name.push(pm.context.package.descriptor.json.name);
        }
        name.push("deploy");
        var targetArchivePath = PATH.join(targetPath,  name.join("-") + ".tar.gz");

        function copy() {

            var deferred = Q.defer();

            var tmpTargetSourcePath = targetSourcePath + "~" + new Date().getTime();
            var tmpTargetSourceIgnorePath = tmpTargetSourcePath + "~ignore";
    
            // NOTE: Do not respect .npmignore ("publishing ignore file") as paths ignored should likely be kept for "deployment (with built packages)" purposes.
            if (PATH.existsSync(PATH.join(packagePath, ".deployignore"))) {

                TERM.stdout.writenl("\0cyan(Using deploy ignore file from: " + PATH.join(packagePath, ".deployignore") + "\0)");
                
                FS.writeFileSync(tmpTargetSourceIgnorePath, FS.readFileSync(PATH.join(packagePath, ".deployignore")));
            } else {
                var ignores = [
                    ".git",
                    ".sourcemint",
                    "*~backup-*"
                ];
                TERM.stdout.writenl("\0cyan(NOTICE: Package '" + packagePath + "' does not have a '.deployignore' file. Using a temporary one that excludes: " + ignores.join(", ") + "\0)");
                FS.writeFileSync(tmpTargetSourceIgnorePath, ignores.join("\n"));
            }

            TERM.stdout.writenl("\0cyan(Copying from '" + packagePath + "' to '" + targetSourcePath + "'.\0)");

            var proc = SPAWN("rsync", [
                "--stats",
                "-r",
                "--copy-links",
                "--exclude-from", tmpTargetSourceIgnorePath,
                packagePath + "/",
                tmpTargetSourcePath
            ]);
    
            proc.on("error", function(err) {
                deferred.reject(err);
            });
            proc.stdout.on("data", function(data) {
                process.stdout.write(data);
            });
            proc.stderr.on("data", function(data) {
                process.stderr.write(data);
            });
            proc.on("exit", function(code) {
                if (code !== 0) {
                    deferred.reject(new Error("Rsync error: " + code));
                    return;
                }
                
                FS.unlinkSync(tmpTargetSourceIgnorePath);
                FS.renameSync(tmpTargetSourcePath, targetSourcePath);
                
                deferred.resolve();
            });

            return deferred.promise;
        }
        
        function archive() {

            var deferred = Q.defer();

            var tmpTargetArchivePath = targetArchivePath + "~" + new Date().getTime();

            TERM.stdout.writenl("\0cyan(Creating archive at '" + targetArchivePath + "' from '" + targetSourcePath + "'.\0)");

            var proc = SPAWN("tar", [
                "-czf",
                tmpTargetArchivePath,
                PATH.basename(targetSourcePath)
            ], {
                cwd: PATH.dirname(targetSourcePath)
            });
   
            proc.on("error", function(err) {
                deferred.reject(err);
            });
            proc.stdout.on("data", function(data) {
                process.stdout.write(data);
            });
            proc.stderr.on("data", function(data) {
                process.stderr.write(data);
            });
            proc.on("exit", function(code) {
                if (code !== 0) {
                    deferred.reject(new Error("Tar error: " + code));
                    return;
                }
                FS.renameSync(tmpTargetArchivePath, targetArchivePath);
                deferred.resolve();
            });

            return deferred.promise;
        }

        return copy().then(function() {

            if (options["no-archive"] === true) {
                return Q.ref();
            }

            return archive().then(function() {

                var deferred = Q.defer();

                EXEC("md5 " + targetArchivePath, function(err, stdout, stderr) {
                    if (err) {
                        deferred.reject(err);
                        return;
                    }

                    var m = stdout.match(/^MD5 \((.*?)\) = ([\w\d]*)[\n$]/);

                    FS.writeFileSync(targetArchivePath + ".checksum", "md5:" + m[2]);
                    
                    var size = ("" + (FS.statSync(targetArchivePath).size / 1024 / 1000)).replace(/^(\d+(\.\d{1,2})?)\d*$/,"$1");

                    TERM.stdout.writenl("\0yellow(Deploy archive size: " + size + " MB\0)");

                    deferred.resolve();
                });            
                return deferred.promise;
            });
        });
    }
    else {
        TERM.stdout.writenl("\0red(" + "ERROR: " + "Target (or parent of) '" + targetUri + "' not found or supported!" + "\0)");
        deferred.reject();
    }
    return deferred.promise;
}
