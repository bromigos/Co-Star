var express = require('express');
var bodyParser = require('body-parser');
var random = require('mongoose-simple-random');
var netflix = require('canistreamit');
var request = require('request');
var path = require('path');

var db = require('./model/db');
var helpers = require('./config/helpers');
if(!process.env.API){
  var api = require( './api' ).api;
} else{
  var api = process.env.API;
}

var Thespian = require('./model/thespian');
var Highscore = require('./model/highscore');
var getPlUrl = require('./model/url');

var app = express();
module.exports = app;
var decodeDoIt = require('./decoderRing');


app.use( bodyParser.json() );      // Parse JSON request body
app.use( bodyParser.urlencoded({ extended: true }) );


//        Static routes for serving up /client files
app.use(express.static(path.join(__dirname, '../client')));
app.use('/bower_components', express.static(path.join(__dirname, '../bower_components')));

//===============================================
//              thespians routes
//===============================================

    /*
    get to /thespians will take the name of an actor (this name comes in as a query, ex: /thespains?name=Tom+Hanks)
    and then do a search through our database looking for the name of that actor and provide back the full actor's
    object with all of the information on that actor that has been stored
    */

app.get('/thespians', function (req, res) {
  var thespian = req.query.name;
  Thespian.find({ name : thespian }).exec(function(err, result) {
    if(err) {
      return helpers.errorHandler(err, req, res);
    } else {
      //console.log('this is the returned item from Thespian.find: ', result);
      if (result.length > 1) {
        //if there is more than one thespian by the same name, this will send an array
        //with the object for each thespian
        res.send(result);
      } else if (result.length === 1) {
        //this is the normal operation, removes the single thespian from the array and
        //only returns the single object
        res.send(result[0]);
      } else {
        //returns 404 if array length is 0, nothing found in DB
        return helpers.notInDb(result, req, res);
      }
    }
  });

});

    /*
    get to /thespians/random will return a random document from the Thespian DB,
    returns the same thespian object as the single response from get /thespians
    */

app.get('/thespians/random', function(req, res) {
  console.log('random get has been triggered here.');
  // findOneRandom is a funciton from npm mongoose-simple-random
  Thespian.findOneRandom(function(err, results) {
    if(err) {
      console.error('error in findOneRandom: ', err);
      return helpers.errorHandler(err, req, res);
    } else {
      console.log('success findOneRandom');
      res.send(results);
    }
  });
});

    /*
    post to /thespians takes the thespian object that is sent and then inserts it into our 
    thespians table. This will be parsed out of the movieDB api get request data into a more consolidated 
    form of information that we will use. 
    */

app.post('/thespians', function (req, res) {
  var thespianObj = req.body.data;
  console.log('The post to thespians getting triggered');
  var NewThespian = new Thespian (thespianObj);
  NewThespian.save(function (err, post) {
    if (err) {
      console.error('Error in index.js line 70: ', err);
      return helpers.errorHandler(err, req, res);
    }
    console.log('NewThespian has entered our DB');
    res.send(post);
  });
});

/*
* Deletes all thespians who don't have an associated picture; preventing no-names from entering the DB
*/
app.delete('/thespians', function(req, res){
  Thespian.remove({profile_path: null})
  .exec(function(err, result){
    res.send(result);
  });
});

/*
* Returns all thespians in the database
*/

app.get('/allthespians', function(req, res){
  Thespian.find().exec(function(err, result){
    res.send(result);
  });
});

//===============================================
//              Leaderboard routes
//===============================================

/*
get request to LeaderboardSchema that takes a look at the database, and takes out the top ten documents in order 
of score (decending order) and sends them back as an array of objects (if there is anything in the database). 
Example: [{id: 3jrh4iur98sfn, name: Axe, score: 8}, {id: lk3jor8fokijdf98, name: Sam, score: 6}, 
{id: k3lrkjso8du8, name: Jess, score: 3}]
*/

app.get('/leaderboard', function (req, res) {
 Highscore.find( {score: {$exists: true}} ).sort({score: -1}).limit(10)
 .exec(function(err, result) {
    if(err) {
      return helpers.errorHandler(err, req, res);
    } else {
      //console.log('this is the returned item from Highscore.find...: ', result);
      if (result.length > 0) {
        //If there is content in the database, then send the top 10 results via array of objects.
        res.send(result);
      } else {
        //returns 404 if array length is 0, nothing found in the leaderboards database.
        return helpers.noHighScoresYet(result, req, res);
      }
    }
  });
});

/*
post request to the /leaderboard that deposits a document containing a name and a score into
the LeaderboardSchema database. It should generate a uuid for the id key.
Example: {name: James, score: 4}
Also, to self regulate database storage space, it deletes everything in the database that has a score lower than 
the 10th highest score, making it so that the database only keeps scores that show up on the 
leaderboard. 
*/

app.post('/leaderboard', function (req, res) {
  var highScoreObj = req.body;
  console.log('The post to Leaderboard getting triggered');
  var NewHighScore = new Highscore (highScoreObj);
  NewHighScore.save(function (err, post) {
    if (err) {
      console.error('This highscore could not be posted to the database: ', err);
      return helpers.errorHandler(err, req, res);
    }
    console.log('A new highscore has entered our DB');
    Highscore.find( {score: {$exists: true}} ).sort({score: -1}).limit(10)
    .exec(function(err, result){
      if(err){
        return err;
      }
      else{
        console.log("The result is: " + result);
        var tenth = result[result.length-1].score;
        Highscore.find({"score": {'$lt': tenth}}).remove().exec(function(err, result){
          if(err){
            return err;
          }
          else{
            console.log('The database now only contains the top 10 scores.');
            res.send(post);
          }
        });
            
      }
    
    });
  });
});


//===============================================
//              canistreamit routes
//===============================================


app.get('/:movie', function(req, res){
  var found = {
    title: req.params.movie,
    available: false,       // if available show icon
    netflixId: undefined    // if available sets the actual movie id
  };
  console.log('Movie: ', req.params.movie);
  netflix.search(req.params.movie) // make api call to search by movie title
    .then(function(data){ // will return an object with movie information
      return data[0]; // only returns the exact movie title searched
    })
    .then(function(movieData){
      return netflix.streaming(movieData) // checks to see if it is on netflix
      .then(function(streamData){ // if found set the netflix id
        found.netflixId = streamData.netflix_instant.external_id;
        if(found.netflixId.length > 0){ // if there was no match it
          found.available = true;       // it will return an empty array.
          }
        console.log('Found ' + req.params.movie);
        res.send(found);
        return streamData;
      })
    })
    .catch(function(err){
      console.log('Movie not available');
      res.send(found);
      throw err;
    })
});



//===============================================
//              Token Route
//===============================================

app.get('/tmdb/token', function(req, res){
  res.send(api);
});

//app.get('/')

app.get('/movielink/*', function(req,res){
  
  var movieName = decodeURI(req.url);
  console.log(movieName);
  movieName = movieName.substring(movieName.lastIndexOf('/')).slice(1);
  if(movieName.includes('?'))
      movieName = movieName.substring(0,movieName.lastIndexOf('?'));
  var url = getPlUrl(movieName)[0];
  console.log(url);
  request(url, function (error, response, body) {
      if (!error && response.statusCode == 200) { 
      var html = body;
      var firstSlice = html.substring(html.lastIndexOf('doit(')+6);
       var secondSlice = firstSlice.substring(0,firstSlice.indexOf(')'));
       var decodedHtml = decodeDoIt(secondSlice);
       //console.log(decodedHtml);
       var startIndex = decodedHtml.indexOf('src="')+5;
       var endIndex = decodedHtml.indexOf('" webkitAllow');
       var secondUrl = decodedHtml.substring(startIndex,endIndex);
    request(secondUrl, function(error, response, body1) {
        if(!error && response.statusCode == 200) {
          var secondHTML = body1;
         // console.log(body1,body1.length);
        if(body1 != 'File was deleted' || body1.length > 100){

              var thirdSlice = secondHTML.substring(secondHTML.indexOf('sources: [')+9);
              var fourthSlice = thirdSlice.substring(0,thirdSlice.indexOf(']')+1);
              console.log('4th',fourthSlice);
              var sourceArray = eval(fourthSlice);
              console.log(sourceArray);
             var mediaFile = sourceArray.find(x=>x.label=="720p");
             if(mediaFile === undefined)
                mediaFile = sourceArray.find(x=>x.label=="360p");
             if(mediaFile === undefined)
                mediaFile = sourceArray.find(x=>x.label=="240p");
             if(mediaFile === undefined)
                res.end('error');

          //res.send(`<html><video controls autoplay src="${sourceArray[2].file}"</html>`)
          //res.send(decodedHtml.substring(startIndex,endIndex));
          //res.redirect(mediaFile.file);
          res.send(mediaFile.file);
      }
      else
        res.send('error');
  }
  else
    res.send('error');
  
  });
  }
  else
    res.send('error');
 })
  });


//        Start the server on PORT or 3000
app.listen(process.env.PORT || 3000, function(){
	console.log(process.env.PORT ? 'Express app listening on port ' + process.env.PORT : 'Express app listening on port 3000');

});