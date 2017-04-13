var fs = require("fs");
var path = require('path');

var fp = __filename;

var fp2 = 'C:\\Users\\hangyang.wang\\Documents\\GitHub\\res-minify\\test';
console.log(fp);
fs.stat(fp2,function(err,s){
	console.log(arguments);
	console.log(s.isFile());
})

//fs.stat


var list = [];
var nextlist = function(){
	var item = nextlist.pop();
	if(item){
		//....
		nextlist();
	}
}


var list = [];
var nextlist = function(arr,fn){
	return nextlist(arr,fn)
}
var fn = function(arr,fn){
	var item = arr.pop();
	if(item){
		//....
		nextlist(arr);
	}
}