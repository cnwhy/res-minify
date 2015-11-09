/**
 * Module dependencies.
 */
var express = require('express');
var http = require('http');
var path = require('path');
var resminify = require("../")

var app = express(),port = 7754



app.use("/",resminify(path.join(__dirname, '../'),{
  directoryList:true //开启目录浏览
  ,cacheFilePaths: path.join(__dirname, '../.catchDir') //设置缓存目录, 不设置则缓存在内存中.
}))
app.use("/web",resminify(path.join(__dirname, '../'),{
  directoryList:true //开启目录浏览
  ,compressJS:false  //关闭JS压缩
}))



app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

app.use(function(err, req, res, next) {
  if(req.xhr){
    res.json({
          "code": -100,
          "msg": err.message || "未知错误"
      })
  }else{
    res.status(err.status || 500);
    res.json(err);
  }
  if(!err.status || err.status >= 500)  console.error(err);
});

//启动服务
http.createServer(app).listen(port, function () {
	console.log('res server listening on port ' + port + " ("+(new Date())+")");
  console.log("http://127.0.0.1:"+port+"/index.js")
  console.log("http://127.0.0.1:"+port+"/web/")
});
