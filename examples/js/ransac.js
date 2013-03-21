"strict";

/*
  Copyright (c) 2010 ASTRE Henri (http://www.visual-experiments.com)

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/

//Point2D
function Point2D(x, y) {
  this.x = x;
  this.y = y;
};

//Line
function Line(a, b) { //y = ax + b
  this.a = a;
  this.b = b;
}

Line.prototype.copy = function(line) {
  this.a = line.a;
  this.b = line.b;
};

function RobustLineFitting(points, threshold, onUpdate, onComplete) {
  return new Ransac(new LineFitting(), points, threshold, onUpdate, onComplete);
}

function LineFitting() {

  this.nbSampleNeeded = 2;

  this.estimateModel = function(points, sample, model) {
    var counter = 0;
    for (var i in sample) {
      _samplePoints[counter] = points[i];
      counter++;
    }

    var p1 = _samplePoints[0];
    var p2 = _samplePoints[1];

    model.a = (p2.y - p1.y) / (p2.x - p1.x);
    model.b = p1.y - model.a * p1.x;
  };

  this.estimateError = function(points, index, model) {
    return Math.abs(points[index].y - model.a * points[index].x - model.b) / Math.sqrt(1 + model.a * model.a);
  };

  var _samplePoints = new Array(this.nbSampleNeeded);
}

function Ransac(fittingProblem, points, threshold, onUpdate, onComplete) {

  var _points = points;
  var _threshold = threshold;
  var _onUpdate = onUpdate;
  var _onComplete = onComplete;

  //var _random      = new Random();
  var _problem = fittingProblem;
  var _bestModel = new Line(0, 0);
  var _bestInliers = {};
  var _bestScore = 4294967295;

  var _currentInliers = [];
  var _currentModel = new Line(1, 0);
  var _nbIters = nbIterations(0.99, 0.5, fittingProblem.nbSampleNeeded);

  var _iterationCounter = 0;
  var _iterationTimer;
  var _that = this;

  function nbIterations(ransacProba, outlierRatio, sampleSize) {
    return Math.ceil(Math.log(1 - ransacProba) / Math.log(1 - Math.pow(1 - outlierRatio, sampleSize)));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
    //return Math.floor(_random.uniform(min, max + 1));
  }

  function randomSample(k, n, sample) {
    var nbInserted = 0;
    while (nbInserted < k) {
      var t = randomInt(0, n - 1);
      if (sample[t] === undefined) {
        sample[t] = true;
        nbInserted++;
      }
    }
  }

  this.run = function() {
    _that.stop();
    _iterationTimer = setInterval(_that.next, 200);
  };

  this.stop = function() {
    if (_iterationTimer) {
      clearInterval(_iterationTimer);
      _iterationTimer = undefined;
    }
    _iterationCounter = 0;
    _bestModel = new Line(0, 0);
    _bestInliers = {};
    _bestScore = 4294967295;
  };

  this.next = function() {
    _currentInliers.length = 0;

    var sample = {};
    randomSample(_problem.nbSampleNeeded, _points.length, sample);
    _problem.estimateModel(_points, sample, _currentModel);

    var score = 0;
    for (var j = 0; j < _points.length; ++j) {
      var err = _problem.estimateError(_points, j, _currentModel);
      if (err > _threshold) {
        score += _threshold;
      } else {
        score += err;
        _currentInliers.push(j);
      }
    }
    if (score < _bestScore) {
      _bestModel.copy(_currentModel);
      _bestInliers = _currentInliers;
      _bestScore = score;
    }

    _onUpdate(_iterationCounter + 1, _nbIters, _currentInliers, _currentModel, _bestModel);

    _iterationCounter++;
    if (_iterationCounter >= _nbIters) {
      _onComplete(_iterationCounter, _nbIters, _currentInliers, _currentModel, _bestModel);
      _that.stop();
    }
  };
}

/*
//Implementation of RobustHomographyEstimation left to the reader :-)

//Match
function Match(a, b) {
  this.indexA = a;
  this.indexB = b;
}

Match.prototype.copy = function(m) {
  this.indexA = m.indexA;
  this.indexB = m.indexB;
};

//Homography
function Homography() {

}

Homography.prototype.copy = function(h) {

};

function RobustHomographyEstimation(points, threshold, onUpdate, onComplete) {
  return new Ransac(new HomographyEstimation(), points, threshold, onUpdate, onComplete);
}

function HomographyEstimation() {
  
  this.nbSampleNeeded = 4;
  
  this.estimateModel = function(points, sample, model) {
  
  };
  
  this.estimateError = function(points, index, model) {
  
  };
  
  var _samplePoints = new Array(this.nbSampleNeeded);
}
*/