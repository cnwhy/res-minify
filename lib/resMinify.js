var fs = require("fs");
var path = require('path');
var CleanCSS = require('@cnwhy/clean-css');
var UglifyJS = require("uglify-js");
var less = require("less");
var Mime = require('mime-types');
var _ = require('underscore');

var Queue = require("promise-queue-plus");

// var q = qf.Q;
var q = Queue.Promise;
var readFile = q.denodeify(fs.readFile),
	fs_stat = q.denodeify(fs.stat),
	readdir = q.denodeify(fs.readdir),
	exists = q.denodeify(fs.exists),
	access = q.denodeify(fs.access);

//内存缓存,对像
var memoryFiles = {};

var defConfigs = {
	"compressCSS": true		//css压缩
	,"reAbsolute": false	//是否转换CSS中原有的绝对路径
	,"compressJS": true		//js压缩
	,"compileLess": true	//编译Less文件
	,"serverCache": true		//服务器缓存
	,"fileMaxAge": 60 * 60 * 24 * 7	//浏览器缓存时间秒 默认一周
	,"cacheFilePaths": ""	//缓存目录 不设置则缓存到内存
	,"directoryList":false	//目录浏览
	,"defaultFile":["index.html","index.htm","default.html","default.htm"]	//默认文件,开启目录浏览后失效;
	,"baseUrl": undefined
}

var UglifyJSConfig = {
	mangle:{
		except : ['require']
	}
}

/**
 * 存入缓存
 * 
 * @param {any} data 
 * @param {any} cacheOption 
 * @param {any} fun 
 */
function saveCache(data, cacheOption) {
	var option = cacheOption;
	//option.cachePath = resServerConfig.cacheFilePaths;
	if (option.Type === "memory") {
		memoryFiles[option.Key] = data;
	} else if (option.Type === "file") {
		access(option.fPath).then(null,function(){
			return q.denodeify(fs.mkdir)(option.fPath);
		}).then(function(){
			return q.denodeify(fs.writeFile)(path.join(option.fPath,option.Key),data);
		}).catch(function(err){
			console.error(err);
		})
	}
}

/**
 * 获取缓存
 * 
 * @param {any} cacheOption 
 * @returns string / ReadStream
 */
function getCache(cacheOption){
	//console.log("getCache");
	if (cacheOption.Type === "memory") {
		return q.resolve(memoryFiles[cacheOption.Key]);
	}else if(cacheOption.Type === "file"){
		var cfile = path.join(cacheOption.fPath,cacheOption.Key);
		return access(cfile,fs.R_OK).then(function(){
			return fs.createReadStream(cfile);
		},function(){return null;})
	}
}

/**
 * 获取默认文件
 * 
 * @param {any} fpath 
 * @param {any} files 
 * @returns 
 */
function getDefFile(fpath,files){
	for(var i = 0; i < files.length; i++){
		var rp = path.join(fpath,files[i])
		try{
			fs.accessSync(rp,fs.R_OK); 
			return rp;
		}catch(e){}
	}
}

/**
 * 返回文件流
 * 
 * @param {any} realPath 
 * @returns 
 */
function sendFile(realPath) {
	return q.resolve(0).then(function(){
		return fs.createReadStream(realPath)
	});
}

//目录浏览
function showFileList(realPath,req,res,next){
	return q.denodeify(fs.readdir)(realPath).then(function(files){
		var html = [];
		html.push('<!DOCTYPE html>');
		html.push('<html>')
		html.push('<head><title><%= decodeURIComponent(title) %></title></head>')
		html.push('<body>')
		html.push('<h1>“<%= decodeURIComponent(title) %>” 目录浏览：</h1>')
		html.push('<ul>')
			html.push('<%if(parsed){%><li><a href="<%=title%>../">..</a></li><%}%>')
			html.push('<% for(var i = 0;i<files.length;i++){%>')
			html.push('<li><a href="<%= title + encodeURIComponent(files[i]) %>"><%= files[i] %></a></li>')
			html.push('<%}%>')
		html.push('</ul>')
		html.push('</body>')
		html.push('</html>')
		var template = _.template(html.join(''));
		res.send(template({
			"title": path.normalize(path.join(req.baseUrl,req.path+"/"))
			,parsed: req.path !== "" && req.path !== "/"
			,"files": files
		}))
		throw 200;
	})
	
}

/**
 * 压缩CSS
 * 
 * @param {any} cssStr 
 * @param {any} relativeTo  //文件目路径
 * @param {any} rootPath    //物理基础路径 用于绝对路径的`@import` 和 reabase url
 * @param {any} baseUrl 	//url 基础路径
 * @param {any} reAbsolute  //是否 根据baseUrl 修改 CSS 中的绝对路径
 * @returns 
 */
function compileCss(cssStr,relativeTo,rootPath,baseUrl,reAbsolute){
	var cssOptions = {
		relativeTo: relativeTo, //文件目路径
		root:rootPath, //物理基础路径 用于绝对路径的`@import` 和 reabase url
		baseUrl:baseUrl, //url 基础路径
		reAbsolute:reAbsolute, //是否 根据baseUrl 修改 CSS 中的绝对路径
	}
	var deferred = q.defer();
	new CleanCSS(cssOptions).minify(cssStr,function(error, minified){
		if(error) return deferred.reject(error);
		deferred.resolve(minified.styles);
	});
	return deferred.promise;
}

/**
 * 处理CSS文件
 * 
 * @param {any} realPath 
 * @param {any} rootPath 
 * @param {any} baseUrl 
 * @param {any} reAbsolute 
 * @returns 
 */
function compileCssFile(realPath,rootPath,baseUrl,reAbsolute){
	var arg = Array.prototype.slice.call(arguments,0);
	arg[0] = path.dirname(realPath);
	return readFile(realPath).then(function(data){
		arg.unshift(data.toString());
		return compileCss.apply(null,arg)
	})
}

/**
 * 处理less文件
 * 
 * @param {any} realPath 
 * @param {any} rootPath 
 * @param {any} baseUrl 
 * @param {any} reAbsolute 
 * @param {any} compressCSS 
 * @returns 
 */
function compileLessFile(realPath,rootPath,baseUrl,reAbsolute,compressCSS){
	var arg = Array.prototype.slice.call(arguments,0,4);
	arg[0] = path.dirname(realPath);
	return readFile(realPath).then(function(data){
		var lessOptions = {
			paths:[path.dirname(realPath)]
			//relativeUrls:true,
			//rootpath:baseUrl,
			//syncImport:true,
			//processImports:true,
			//strictImports:true,
			//compress:Con.compressCSS
		}
		return q.denodeify.call(less,less.render)(data.toString(),lessOptions).then(function(output){
			if(!compressCSS) return output.css;
			arg.unshift(output.css);
			return compileCss.apply(null,arg);
		})
	})
}

var emptfn = function(){};
var throwCode = function(code){
	return function(){
		throw code || 404;
	}
}
var t404 = throwCode(404);
var t200 = throwCode(200);

//单个文件处理中间件
module.exports = function resServer(rootPath,configs){
	var Con = _.extend({},defConfigs,configs);
	
	if(!fs.existsSync(rootPath)){
		console.warn(rootPath+" 不存在!")
		return function(req,res,next){next();}
	}
	/**
	 * 根据文件设置header
	 * 
	 * @param {any} realPath 
	 * @param {any} arg 
	 * @returns 
	 */
	function getheader(realPath,arg){
		var mime = Mime.contentType(path.extname(realPath)) || 'text/plain',				//文件类型对应的mime
			maxAge = this.fileMaxAge || 60 * 60 * 24 * 30,				//fileMaxAge单位为秒
			expires = new Date(Date.now() + maxAge * 1000);				//过期的具体时间
		//mime += mime.indexOf("text/") == 0 ? ";charset=utf-8" : "";		//对文本文件类型默认加上charset
		var header = {'Content-Type': mime}
		if(Con.serverCache) { 										//服务器缓存开关
			header['Expires'] = expires.toUTCString();				//浏览器缓存的到期时间,低于"Cache-Control"的"max-age";
			header['Cache-Control'] = 'max-age=' + maxAge;			//浏览器缓存时长(秒);
			header['Last-Modified'] = arg.mtime.toUTCString();		//加上文件修改时间;
		}
		return header;
	}


	return function(req,res,next){
		var realPath,baseUrl;
		baseUrl = Con.baseUrl == undefined ? req.baseUrl : Con.baseUrl;
		realPath = path.normalize(path.join(rootPath, decodeURIComponent(req.path)));	//文件实际路径

		function sendFile(fp,arg){
			//return fs.createReadStream(fp).then(function(){
				res.set(arg.header);
				fs.createReadStream(fp).pipe(res);
				throw 200;
			//});
		}

		function argInit(stat){
			//计算文件修改时间
			var u_serch = req._parsedUrl.search;
			var isDirectory = stat.isDirectory();
			var arg = {
				realPath: realPath,
				isDirectory: isDirectory,
				isFile : stat.isFile(),
				isCancatFile : isDirectory && u_serch && u_serch.indexOf("??") == 0
			}
			if(arg.isCancatFile){//合并文件基本变量
				var filesStr = u_serch.substr(2).replace(/\?.*$/,"");
				var files = filesStr ? filesStr.split(/\s*\,+\s*/):[];
				if(files.length <= 0){
					arg.isCancatFile = false;
					return arg;
				}
				arg.files = files.slice(0);
				//多文件则找最后被修改的文件做为 修改时间
				arg.files_realPaths = files.map(function(v){
					return path.normalize(path.join(realPath,v));
				})
				var p_list = arg.files_realPaths.map(function(v){
					if(v.indexOf(rootPath) !== 0) return q.reject(new Error("超出权限范围!"))
					return fs_stat(v);
				})
				return q.all(p_list).then(function(list){
					var k = 0;
					list.forEach(function(v){
						if(v.mtime > k){
							k = v.mtime
						}
					})
					arg.mtime = k;
					return arg;
				})
			}else if(arg.isFile){
				arg.mtime = stat.mtime;
				return arg;
			}else if(arg.isDirectory){
				if(Con.directoryList){
					return showFileList(realPath,req,res,next);
				}else{
					var df = getDefFile(realPath,Con.defaultFile);
					if(df){
						return sendFile(df,arg);
					}else{
						throw 404;
					}
				}
			}else{
				console.warn("[resMinify] "+realPath+" 类型不支持!")
				throw 404;
			}
		}

		//浏览器304处理
		function comm304(arg){
			if (Con.fileMaxAge 
				&& req.headers['if-modified-since'] 
				&& req.headers['if-modified-since'] == arg.mtime.toUTCString()) { //浏览器缓存,并判断缓存后文件是否更改
					res.status(304).end();	//res.writeHead(304, "Not Modified");res.end();
					// return q.reject(304);
					throw 304;
			}
			// return q.resolve(arg);
			return arg;
		}

		//文件类型 及 header
		function commHeader(arg){
			if(arg.isFile){//单个文件基本变量
				arg.type = path.extname(arg.realPath).toLowerCase().substr(1) || "*";	//获取文件类型
				arg.header = getheader(arg.realPath,arg);
			}
			if(arg.isCancatFile){
				var firstFile = arg.files_realPaths[0];
				arg.type = path.extname(firstFile).toLowerCase().substr(1);
				arg.type && (arg.header = getheader(firstFile,arg));
			}
			return arg;
		}

		//处理缓存
		function commCatch(arg){
			var cacheName,cacheOption;
			if(Con.serverCache){
				if(arg.isFile){
					cacheName = (baseUrl+req.path).replace(/[\/\\]/g, "&");
				}else if(arg.isCancatFile){
					cacheName = (baseUrl+req.path).replace(/[\/\\]/g, "&") + "#" + arg.files.join("+").replace(/[\/\\]/g, "&")
				}
				if (cacheName) {
					cacheOption = {
						Key : cacheName,
						Type : Con.cacheFilePaths ? "file" : "memory",
						fPath : Con.cacheFilePaths
					}
					//内存缓存
					return getCache(cacheOption).then(function(cache){
						if(typeof cache == "string"){
							//resEnd(cache,1,arg);
							res.writeHead(200,arg.header);
							res.end(cache);
						}else if(cache && typeof cache.pipe == 'function'){
							res.writeHead(200,arg.header);
							cache.pipe(res);
						}else{
							arg.cacheOption = cacheOption;
							return arg;
						}
						throw 200;
					}).then(null,function(err){
						if(err === 200) throw err;
						return arg;
					})
				}
			}
			return arg;
		}
		

		function resEnd(str,arg,isCache){
			return q.resolve(0).then(function(){
				res.set(arg.header);
				res.end(str);
				Con.serverCache && !isCache && saveCache(str, arg.cacheOption);
				throw 200;
			})
		}

		function commFile(type,realPath,files){
			//var type = path.extname(realPath).toLowerCase().replace(".", "") || "*";	//获取文件类型
			type = type === "less" ? "css" : type;
			var _type = path.extname(realPath).toLowerCase().replace(".", "");
			if (_type === "less" && type === "css" && Con.compileLess) {
				return compileLessFile(realPath,rootPath,baseUrl,Con.reAbsolute,Con.compressCSS)
			}else if(_type === "css" && type === "css" && Con.compressCSS){
				return compileCssFile(realPath,rootPath,baseUrl,files ? false : Con.reAbsolute);
			}else if(_type === "js" && type === "js" && Con.compressJS){
				return q.delay(0).then(function(){
					return UglifyJS.minify(realPath,UglifyJSConfig)
				}).then(function(minifyjs){
					return minifyjs.code;
				})
			}
			return q.reject('此类型文件不支持处理!');
		}

		function commCancatFile(arg){
			var defs = [],realPaths = arg.files_realPaths;
			if(arg.type === 'js'){
				// if((arg.isFile && Con.compressJS) || arg.isCancatFile){
					return q.delay(0).then(function(){
						return UglifyJS.minify(arg.isFile ? realPath : realPaths,UglifyJSConfig)
					}).then(function(minifyjs){
						return resEnd(minifyjs.code,arg);
					})
				// }
			}else if(arg.type === 'less' || arg.type === 'css'){
				for (var i = 0, j = realPaths.length; i < j; i++) {
					(function(i){
						var fp = realPaths[i];
						// var def = compileLessFile(fp,rootPath,baseUrl,Con.reAbsolute,true);
						var def = commFile(arg.type,fp)
						defs.push(def);
					})(i)
				}
				return q.all(defs).then(function(dataArr){
					var strs = dataArr.join('');
					if(arg.type === 'less'){
						if(Con.compressCSS) 
							return compileCss(strs,realPath,rootPath,baseUrl,false);
						else 
							return strs;
					}else if(arg.type === 'css'){
						return compileCss(strs,realPath,rootPath,baseUrl,false);
					}
				}).then(function(data){
					return resEnd(data,arg)
				})
			}else{
				throw new Error("不支持此类文件的合并");
			}
		}



		fs_stat(realPath).then(argInit,t404)
		.then(comm304)
		.then(commHeader)
		.then(commCatch)
		.then(function(arg){
			if(arg.isFile){
				return q.resolve(0).then(function(){
					return commFile(arg.type,arg.realPath).then(function(data){
						return resEnd(data,arg)
					},function(){
						return arg;
					})
				}).then(function(){
					return sendFile(realPath,arg);
				})
			}
			if(arg.isCancatFile){
				return commCancatFile(arg);
			}
			throw 404;
		}).catch(function(err){
			if(err === 404) return next();
			if(err === 200 || err === 304) return;
			next(err);
		})		
	}
}