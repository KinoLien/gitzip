(function(scope){
    function fn(){};

    var repoExp = new RegExp("^https://github.com/([^/]+)/([^/]+)(/(tree|blob)/([^/]+)(/(.*))?)?");
    var githubProvidedUrl = new RegExp("^https://api.github.com/.*");
    var isBusy = false;
    var isSafari = Object.prototype.toString.call(window.HTMLElement).indexOf('Constructor') > 0 && 
        /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

    var token;

    var statusHandle = function(status){
        if(status == 'error' || status == 'done') isBusy = false;
        else isBusy = true;
    };

    /**
     * @typedef ResolvedURL
     * @type Object
     * @property {string} author - The project owner
     * @property {string} project - The project name
     * @property {string} branch - The default branch or other branches
     * @property {string} type - The type of url link, values: tree, blob, link?
     * @property {string} path - The path of target file/dir based on root repo url.
     * @property {string} inputUrl - The input url
     * @property {string} rootUrl - The root dir url
     */

    /**
     * This callback would call by each progress changes.
     * @callback progressCallback
     * @param {string} status - indicates the status description like 'error', 'prepare', 'processing', 'done'
     * @param {string} message - the messages of the above status.
     * @param {number} percent - from 0 to 100, indicates the progress percentage.
     */
    var progressCallback = function(status, message, percent){};

    var _getContentOfGitUrl = function(url, params){
        params = params || {};
        if(token) params["access_token"] = token;
        return Promise.resolve(
            $.ajax({
                url: url,
                data: params
            })
        ).then(function(results){ return results.content; });
    };

    var _getTreeOfGitUrl = function(url, params){
        params = params || {};
        if(token) params["access_token"] = token;
        return Promise.resolve(
            $.ajax({
                url: url,
                data: params
            })
        ).then(function(results){
            var nextReturn = [];
            if(results.truncated){
                progressCallback.call(callbackScope, 'error', 'The tree travels is over than API limitation (500 files)');
                throw ("The tree travels is over than API limitation (500 files)");
            };
            results.tree.forEach(function(item){
                if(item.type == "blob"){
                    progressCallback._len++;
                    nextReturn.push({url: item.url, path: item.path});
                }
            });
            return nextReturn;
        });
    };

    var _zipContents = function(filename, contents, callbackScope){
        var zip = new JSZip();
        contents.forEach(function(item){
            progressCallback.call(callbackScope, 'processing', 'Compressing ' + item.path,
                ++progressCallback._idx / (progressCallback._len * 2) * 100);
            zip.file(item.path, item.content, {createFolders:true,base64:true});
        });
        if(isSafari){
            zip.generateAsync({type:"base64"})
            .then(function (content) {
                downloadZipUseElement("data:application/zip;base64," + content);
                alert("Please remember change file name to xxx.zip");
            });
        }else{
            zip.generateAsync({type:"blob"})
            .then(function (content) {
                saveAs(content, filename + ".zip");
            }, function(error){
                console.log(error);
            });
        }
        progressCallback.call(callbackScope, 'done', 'Saving ' + filename + '.zip');
    };

    /**
     * Resolve the github repo url for recognize author, project name, branch name, and so on.
     * @private
     * @param {string} repoUrl - The github repo url.
     * @param {ResolvedURL}
     */
    function resolveUrl(repoUrl){
        if(typeof repoUrl != 'string') return;
        var matches = repoUrl.match(repoExp);
        if(matches && matches.length > 0){
            var root = (matches[5])?
                "https://github.com/" + matches[1] + "/" + matches[2] + "/tree/" + matches[5] :
                repoUrl;
            return {
                author: matches[1],
                project: matches[2],
                branch: matches[5],
                type: matches[4],
                path: matches[7] || '',
                inputUrl: repoUrl,
                rootUrl: root
            };
        }
    }

    /**
     * Force to trigger download dialog for any mine-type files using Native A Element.
     * @param {string} url - The URL.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function downloadZipUseElement(url, callbackScope){
        var down = document.createElement('a');
        down.setAttribute('download', true);
        down.href = url;
        down.addEventListener('click', function(e){
            progressCallback.call(callbackScope, 'done', 'Saving File.');
        });
        setTimeout(function(){
            // link has to be in the page DOM for it to work with Firefox
            document.body.appendChild(down);
            down.click();
            down.parentNode.removeChild(down);
        },100);
    }

    /**
     * Force to trigger download dialog for any mine-type files.
     * @param {string} url - The URL.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function downloadZip(url, callbackScope){
        callbackScope = callbackScope || scope;
        if(url){
            progressCallback.call(callbackScope, 'processing', 'Fetching target url: ' + url);
            var params = {};
            if(token) params["access_token"] = token;
            $.ajax( { url: url, data: params } )
                .fail(function(jqXHR, textStatus, errorThrown){
                  console.error('downloadZip > $.get fail:', textStatus);
                  if (errorThrown) throw errorThrown;
                })

                .done(function(data, textStatus, jqXHR){
                    var blob = new Blob([data], {
                        type: jqXHR.getResponseHeader('Content-Type') ||
                            'application/octet-stream'
                    });

                    var down = document.createElement('a');
                    down.download = url.substring(url.lastIndexOf('/') + 1);
                    down.href = URL.createObjectURL(blob);

                    down.addEventListener('click', function(e){
                        progressCallback.call(callbackScope, 'done', 'Saving File.');
                    });

                    setTimeout(function(){
                        // link has to be in the page DOM for it to work with Firefox
                        document.body.appendChild(down);
                        down.click();
                        down.parentNode.removeChild(down);
                    }, 100);
              });
        }
    }

    /**
     * Download zip file from github api url.
     * @param {string} zipName - The zip file name.
     * @param {string} url - The github api url.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function zipIt(zipName, url, callbackScope){
        callbackScope = callbackScope || scope;
        if(url && githubProvidedUrl.test(url)){
            progressCallback.call(callbackScope, 'prepare', 'Fetching list of Dir contains files.');
            var params = {};
            if(token) params["access_token"] = token;
            params["recursive"] = 1;
            $.ajax({
                url: url,
                data: params,
                success: function(results){
                    var promises = [];
                    var fileContents = [];
                    if(results.truncated){
                        progressCallback.call(callbackScope, 'error', 'The tree travels is over than API limitation (500 files)');
                        throw ("The tree travels is over than API limitation (500 files)");
                    };
                    progressCallback._idx = 0;
                    progressCallback._len = 0;
                    results.tree.forEach(function(item){
                        if(item.type == "blob") progressCallback._len++;
                    });
                    results.tree.forEach(function(item){
                        if(item.type == "blob"){
                            var p = {};
                            promises.push(
                                _getContentOfGitUrl(item.url, p)
                                .then(function(content){
                                    var path = item.path;
                                    fileContents.push({path:path,content:content});
                                    progressCallback.call(callbackScope, 'processing', 'Fetched ' + path,
                                        ++progressCallback._idx / (progressCallback._len * 2) * 100);
                                })
                            );
                        }
                    });

                    Promise.all(promises).then(function() {
                        _zipContents(zipName, fileContents, callbackScope);
                    },function(item){
                        if(item){
                            progressCallback.call(callbackScope, 'error', 'Error: ' + JSON.stringify(item));
                            throw (JSON.stringify(item) + " ERROR");
                        }
                    });
                },
                error:function(e){
                    progressCallback.call(callbackScope, 'error', 'Error: ' + e);
                    throw (e);
                }
            });
        }
    }

    /**
     * Download zip for single file from input repo URL.
     * @param {string} pathToFolder - The URL of the Github repository.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function createURL(pathToFolder, callbackScope){
        if(isBusy) throw "GitZip is busy...";
        callbackScope = callbackScope || scope;
        progressCallback.call(callbackScope, 'prepare', 'Resolving URL');
        var resolved = resolveUrl(pathToFolder);
        if(!resolved){
            progressCallback.call(callbackScope, 'error', 'Invalid URL: value is [' + pathToFolder.toString() + ']');
            throw "INVALID URL";
        }
        if(!resolved.path){
            // root
            var durl = [
                "https://github.com", resolved.author, resolved.project,
                "archive", (resolved.branch || 'master')
            ].join('/');
            var gitURL = durl + ".zip";
            // downloadZip(gitURL, callbackScope);
            downloadZipUseElement(gitURL, callbackScope);
        } else{

            progressCallback.call(callbackScope, 'prepare', 'Finding file/dir content path from resolved URL');
            var params = {};
            if(resolved.branch) params["ref"] = resolved.branch;
            if(token) params["access_token"] = token;            

            Promise.resolve(
                $.ajax({
                    url: "https://api.github.com/repos/"+ resolved.author +
                        "/" + resolved.project + "/contents/" + resolved.path,
                    data: params
                })
            ).then(function(results){
                var templateText = '';
                if(!Array.isArray(results)){
                    // means file
                    if(results.message){
                        progressCallback.call(callbackScope, 'error', 'Github said: '+results.message);
                        throw ("Error: " +  results.message);
                    }else downloadZip(results.download_url, callbackScope);
                    return;
                }
                progressCallback.call(callbackScope, 'prepare', 'Fetching list of Dir contains files.');
                progressCallback._idx = 0;
                progressCallback._len = 0;
                var nextReturn = [];
                results.forEach(function(item){
                    if(item.type == "dir"){
                        nextReturn.push(_getTreeOfGitUrl(item.git_url, { recursive:1 })
                        .then(function(results){
                            return results.map(function(t){
                                t.path = item.path.split('/').pop() + "/" + t.path;
                                return t;
                            });
                        }));
                    }else if(item.type == "file"){
                        nextReturn.push(new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                progressCallback._len++;
                                resolve([{url:item.git_url,path:item.path.split('/').pop()}]);
                            }, 10);
                        }));
                    }
                });
                return nextReturn;
            }, function(results){
                progressCallback.call(callbackScope, 'error', 'Github said: ' + JSON.stringify(results));
                throw (JSON.stringify(results));
            }).then(function(results){
                Promise.all(results).then(function(res){
                    var urls = [];
                    var fetches = [];
                    res.forEach(function(item){
                        urls = urls.concat(item);
                    });
                    urls.forEach(function(item){
                        fetches.push(
                            _getContentOfGitUrl(item.url)
                            .then(function(content){
                                var path = item.path;
                                progressCallback.call(callbackScope, 'processing', 'Fetched ' + path,
                                    ++progressCallback._idx / (progressCallback._len * 2) * 100);
                                return {path:path, content:content};
                            })
                        );
                    });
                    return fetches;
                }).then(function(urls){
                    Promise.all(urls).then(function(contents){
                        _zipContents(resolved.path.split('/').pop(), contents, callbackScope);
                    },function(item){
                        if(item){
                            progressCallback.call(callbackScope, 'error', 'Error: ' + JSON.stringify(item));
                            throw (JSON.stringify(item) + " ERROR");
                        }
                    });
                });
            });
        }
    }

    /**
     * Register the progress callback for handleing the progress is changing.
     * @param {progressCallback} inputFn - The progress callback.
     */
    function registerCallback(inputFn){
        if(typeof inputFn == 'function'){
            // progressCallback = callback;
            progressCallback = function(){
                inputFn.apply(this, arguments);
                statusHandle.apply(this, arguments);
            };
        }
    }

    function setAccessToken(strToken){
        token = strToken;
    }

    fn.zipRepo = createURL;
    fn.zipFromApiUrl = zipIt;
    fn.downloadFile = downloadZip;
    fn.registerCallback = registerCallback;
    fn.setAccessToken = setAccessToken;

    scope.GitZip = fn;

})(window);
