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

    var resolveUrl = function(repoUrl){
        if(typeof repoUrl != 'string') return;
        var matches = repoUrl.match(repoExp);
        if(matches && matches.length > 0){
            var root = (matches[5])? 
                "https://github.com/" + matches[1] + "/" + matches[2] + "/tree/" + matches[5] :
                repoUrl;
            return {
                author: matches[1],
                project: matches[2],
                branch: matches[5] || 'master',
                type: matches[4] || '',
                path: matches[7] || '',
                inputUrl: repoUrl,
                rootUrl: root
            };
        }
    };

    var _githubUrlChecker = {
        _workerBlobUrl: null,
        _branchChecker: function(baseUrl, branch, path){
            
            if(!this._workerBlobUrl){
                this._workerBlobUrl = URL.createObjectURL( new Blob([ '(',
                    function(){
                        //Long-running work here
                        function makeRequest (opts) {
                            var xhr = new XMLHttpRequest();
                            var params = opts.params, strParams;
                            if (params && typeof params === 'object') {
                                strParams = Object.keys(params).map(function (key) {
                                    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
                                }).join('&');
                            }
                            xhr.open(opts.method || 'GET', opts.url + "?" + strParams, false);
                            if (opts.headers) {
                                Object.keys(opts.headers).forEach(function (key) {
                                    xhr.setRequestHeader(key, opts.headers[key]);
                                });
                            }
                            xhr.send();
                            if(xhr.status == 200) return xhr.response;
                            return { status: xhr.status, statusText: xhr.statusText };
                        }
                        onmessage = function(e){
                            // e.data
                            var inputData = e.data;
                            
                            var toBreak = false;
                            var branchTry = inputData.branchTry,
                                pathTry = inputData.pathTry,
                                params = inputData.params,
                                pathTryQueue = pathTry.split('/');   // case: ["2.1", "Examples", "Evaluation", "UWPImageRecognition", "ImageRecognizerLib"]

                            if(pathTryQueue[pathTryQueue.length-1] == "") pathTryQueue.pop();
                            var results = {};
                            while(!toBreak){ // case: release, release/2.1
                                params["ref"] = branchTry;
                                
                                var res = makeRequest({
                                    url: inputData.baseUrl + pathTry,
                                    params: params
                                });

                                if(res.status){
                                    if(pathTryQueue.length){
                                        branchTry += "/" + pathTryQueue.shift();
                                        pathTry = pathTryQueue.join('/');
                                        // case: 2.1/Examples/Evaluation/UWPImageRecognition/ImageRecognizerLib, Examples/Evaluation/UWPImageRecognition/ImageRecognizerLib
                                    }else toBreak = true;
                                }else{
                                    results.branch = branchTry;
                                    results.path = pathTry;
                                    toBreak = true;
                                }
                            }
                            if(results.branch) postMessage(results);
                            else postMessage(null);
                            close();
                        };
                    }.toString(),
                ')()' ], { type: 'application/javascript' } ) );
            }
            
            var checkWorker = new Worker( this._workerBlobUrl );
            
            if(path && path[path.length-1] == "/") path = path.substring(0, path.length - 1);
            // pass parameter to worker
            checkWorker.postMessage({
                baseUrl: baseUrl,
                branchTry: branch,
                pathTry: path || "",
                params: token? { "access_token" : token } : {}
            });

            return new Promise(function(resolve, reject){
                checkWorker.onmessage = function(e){
                    // e.data
                    if(e.data && typeof e.data == "object") resolve(e.data);
                    else reject(e.data);
                };
            });
        },
        caches: [],
        /**
         * Resolve the github repo url for recognize author, project name, branch name, and so on.
         * @private
         * @param {string} repoUrl - The github repo url.
         * @return {Promise<ResolvedURL>}
         */
        check: function(repoUrl){
            // test case: https://github.com/Microsoft/CNTK/tree/release/2.1/Examples/Evaluation/UWPImageRecognition/ImageRecognizerLib
            if(typeof repoUrl != 'string') return Promise.reject();

            var self = this,
                results = {};

            if(repoUrl[repoUrl.length-1] == "/") repoUrl = repoUrl.substring(0, repoUrl.length - 1);
            
            if(!window.Worker){
                results = resolveUrl(repoUrl);
                if(results) return Promise.resolve(results);
                else return Promise.reject();
            }

            results.inputUrl = repoUrl;
            // load from cache
            if(self.caches.length > 0){
                for(var i = 0, len = self.caches.length; i < len; i++){
                    var item = self.caches[i];
                    // https://github.com/Microsoft/CNTK/(tree|blob)/release/2.1(/.*)?
                    var patternExp = new RegExp("^" + item.pattern);
                    var matches = repoUrl.match(patternExp);
                    if(matches && matches.length > 0){
                        results.author = item.author;
                        results.project = item.project;
                        results.branch = item.branch || "master";
                        results.type = matches[1] || "";
                        results.path = matches[3] || "";
                        results.inputUrl = repoUrl;
                        results.rootUrl = item.rootUrl;
                        return Promise.resolve(results);
                    }
                }
            }

            var matches = repoUrl.match(repoExp);
            if(matches && matches.length > 0){
                results.author = matches[1];    // case: Microsoft
                results.project = matches[2];   // case: CNTK
                results.branch = results.path = results.rootUrl = "";
                if(matches[4]){ // case: tree
                    
                    results.type = matches[4];

                    return new Promise(function(resolve, reject){
                        self._branchChecker("https://api.github.com/repos/"+ results.author + "/" + results.project + "/contents/", matches[5], matches[7])
                        .then(function(res){
                            var rootUrl = "https://github.com/" + results.author + "/" + results.project + "/tree/" + res.branch;
                            self.caches.push({
                                author: results.author,
                                project: results.project,
                                branch: res.branch,
                                pattern: "https://github.com/" + results.author + "/" + results.project + "/(tree|blob)/" + res.branch + "(/(.*))?",
                                rootUrl: rootUrl
                            });
                            results.branch = res.branch;
                            results.path = res.path;
                            results.rootUrl = rootUrl;
                            resolve(results);
                        })
                        .catch(function(msg){ reject(msg); });
                    });
                }else{
                    results.rootUrl = "https://github.com/" + results.author + "/" + results.project;
                    return Promise.resolve(results);
                }
            }
            return Promise.reject();
        }
    }


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
        _githubUrlChecker.check(pathToFolder)
        .then(function(resolved){
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

                // get up level url
                var originPath = resolved.path;
                var originInput = resolved.inputUrl;
                if(resolved.type == "tree"){
                    var tmp;
                    (tmp = originInput.split('/')) && tmp.pop() && (resolved.inputUrl = tmp.join('/'));
                    (tmp = originPath.split('/')) && tmp.pop() && (resolved.path = tmp.join('/'));
                }

                Promise.resolve(
                    $.ajax({
                        url: "https://api.github.com/repos/"+ resolved.author +
                            "/" + resolved.project + "/contents/" + resolved.path,
                        data: params
                    })
                ).then(function(results) {
                    var templateText = '';
                    if(!Array.isArray(results)){
                        if(results.message){
                            progressCallback.call(callbackScope, 'error', 'Github said: '+results.message);
                            throw ("Error: " +  results.message);
                        }else downloadZip(results.download_url, callbackScope);
                        return;
                    }
                    var urlHasFound = false;
                    for(var i = 0, len = results.length; i < len; i++){
                        var item = results[i];
                        // target has found
                        if(item.type == "dir" && item.html_url == originInput){
                            var valueText = item.path;
                            var pathText = valueText.split('/').pop();
                            var urlText = item.git_url;
                            urlHasFound = true;
                            zipIt(pathText, urlText, callbackScope);
                            break;
                        }
                        if(i + 1 == len){
                            progressCallback.call(callbackScope, 'error', 'File/Dir content not found.');
                        }
                    }
                    if(urlHasFound){
                        // do not go to "then"
                        return Promise.reject();
                    }else{
                        // maybe a large directory, and go to next to find path
                        resolved.path = originPath;
                        resolved.inputUrl = originInput;
                        return Promise.resolve();
                    }
                }, function(results){
                    progressCallback.call(callbackScope, 'error', 'Github said: ' + JSON.stringify(results));
                    throw (JSON.stringify(results));
                }).then(function(){
                    return Promise.resolve(
                        $.ajax({
                            url: "https://api.github.com/repos/"+ resolved.author +
                                "/" + resolved.project + "/contents/" + resolved.path,
                            data: params
                        })
                    );
                }).then(function(results){
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
        })
        .catch(function(){
            progressCallback.call(callbackScope, 'error', 'Invalid URL: value is [' + pathToFolder.toString() + ']');
            throw "INVALID URL";
        });
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
    fn.urlResolver = _githubUrlChecker;

    scope.GitZip = fn;

})(window);
