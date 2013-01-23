requirejs.config({
    baseUrl: 'lib',
    paths: {
      bootstrap: 'bootstrap/js/bootstrap',
    },
    shim: {
      underscore: {
        exports: '_'
      },
      bootstrap: {
        deps: ['jquery']
      },
      date: {
        deps: ['jquery']
      },
      time: {
        deps: ['date']
      }
    }
});
define(function(require, exports, module) {
    var _ = require('underscore');
    require('bootstrap');
    require('date');
    require('time');

    var states = ['selected', 'implement', 'review', 'test', 'released'],
        triageTimes = [],
        selectedTimes = [],
        assignedTimes = [],
        implementTimes = [],
        reviewTimes = [],
        testTimes = [],
        releaseTimes = [],
        ghBugs = [],
        bzBugs = [],
        kanBugs = {},
        ghRequests = [],
        bzRequests = [];

    _.each(states, function(state) {
      kanBugs[state] = [];
    });

    var formatDateTime = function(date_time_in) {
        var date_time = date_time_in.replace("T", " ");
        date_time = date_time_in.replace("Z", "");
        return date_time;
    }

    var calculateAverageDays = function(timespan_array) {
      var sum = 0,
          avg = 0,
          avg_days = 0,
          count = timespan_array.length;
      for (var i=0; i < count; i++) {
        sum += timespan_array[i];
      }
      avg = sum/count;
      avg_days = Math.round((avg/86400000) * 10)/10;
      return avg_days;
    }

    var recordColumnDuration = function(bug, state_datetime, previous_state_datetime, duration_property, times_array) {
      var ts = new TimeSpan(previous_state_datetime - state_datetime);
      var ts_ms = ts.getTotalMilliseconds();
      if (ts_ms < 0) {
        console.log("Skipping negative column value for calculation.");
        return 0;
      } else {
        bug[duration_property] = ts_ms;
        times_array.push(ts_ms);
        return ts_ms;
      }
    }

    //console.log(kanBugs);

    var addGhBugs = function(data) {
      _.each(data, function(pull){
        console.log("Pull " + pull.number + "...");
        var bugRE = /fix bug (\d+)/i;
        var bugArray = bugRE.exec(pull.title);
        if (bugArray && typeof(bugArray[1]) != undefined) {
          var bugID = bugArray[1];
          console.log("... fixes bug " + bugID);
          var ghBug = {id: bugID, state: pull.state, created_at: pull.created_at, merged_at: pull.merged_at};
          ghBugs.push(ghBug);
        }
      });
      //console.log(data);
    };

    var loadGhBugs = function(){
      // Get MDN pull requests from GitHub - both open and closed
      var github_client_id = '6f879db8324dca8c26f1',
          github_client_secret = 'da455accd2ff34dbbc52697c7649f49b717ec98d';
      var githubURL = "https://api.github.com/repos/mozilla/kuma/pulls";
      $('#progress-bar').text("Fetching open pull requests ...");
      var getting_open_pulls = $.getJSON(githubURL, {
                  client_id: github_client_id,
                  client_secret: github_client_secret
                  });
      ghRequests.push(getting_open_pulls);
      // TODO: make this actually walk the pull request pages
      githubURL += "?state=closed&per_page=100";
      for (var page=0; page < 10; page++) {
        var gettingPulls = $.getJSON(githubURL + "&page=" + page, {
                    client_id: github_client_id,
                    client_secret: github_client_secret
                    });
        $.when(gettingPulls).done(addGhBugs);
        ghRequests.push(gettingPulls);
      }
    };

    var processBzBugs = function(data) {
      // console.log("processBzBugs");
      // console.log("data.bugs: " + JSON.stringify(data.bugs));
      var num_bugs_total = data.bugs.length,
          num_bugs_processed = 0;
      _.each(data.bugs, function(bug){
        // console.log("processing bug:" + bug.id + "...");
        var li = "<li><a href=\"https://bugzilla.mozilla.org/show_bug.cgi?id=" + bug.id + "\" target=\"_blank\">" + bug.id + "</a></li>";
        var $storyList = $('ul#story');
        var $implementList = $('ul#implement');
        var $reviewList = $('ul#review');
        var $testList = $('ul#test');
        var $releasedList = $('ul#released');

        // Where is this bug now?
        // Start from the right of the board and work left
        if (bug.status == 'VERIFIED') {
          kanBugs['released'].push(bug);
          $releasedList.append(li);
        } else if (bug.status == 'RESOLVED') {
          kanBugs['test'].push(bug)
          $testList.append(li);

        // Check the list of GitHub bugs to see if a pull request is in for the bug
        } else if (_.contains(_.pluck(ghBugs, 'id'), bug.id.toString())){
          kanBugs['review'].push(bug);
          $reviewList.append(li);
        } else if (bug.assigned_to.name !== 'nobody') {
          kanBugs['implement'].push(bug);
          $implementList.append(li);
        } else {
          kanBugs['selected'].push(bug);
          var $selectedList = $('ul#selected');
          $selectedList.append(li);
        }

        // When did it hit each column?
        // columns based on simple bug fields
        bug['created_at'] = Date.parse(formatDateTime(bug.creation_time));
        bug['merged_at'] = Date.parse(bug.cf_last_resolved);

        // columns based on bug history
        _.each(bug.history, function(entry) {
          _.each(entry.changes, function(change) {
                   if (change.field_name == 'status' &&
                       change.added == 'VERIFIED') {
              bug['verified_at'] = Date.parse(formatDateTime(entry.change_time));
            } else if (change.field_name == 'assigned_to' &&
                       change.removed == 'nobody@mozilla.org') {
              bug['assigned_at'] = Date.parse(formatDateTime(entry.change_time));
            } else if (change.field_name == 'whiteboard' &&
                       change.removed == '' &&
                       change.added.indexOf('p=') > -1) {
              bug['selected_at'] = Date.parse(formatDateTime(entry.change_time));
            }
          });
        });

        // column based on github
        _.each(ghBugs, function(ghBug) {
          if (ghBug.id == bug.id) {
            console.log("ghBug.id: " + ghBug.id + " matches bug.id: " + bug.id);
            bug['implemented_at'] = Date.parse(formatDateTime(ghBug.created_at));
            console.log(bug['implemented_at']);
            console.log(bug['assigned_at']);
          }
        });

        // How long did the bug take in each column?
        if (bug['selected_at']) {
          recordColumnDuration(bug, bug['created_at'], bug['selected_at'], 'tts', triageTimes);
          if (bug['assigned_at']) {
            recordColumnDuration(bug, bug['selected_at'], bug['assigned_at'], 'tta', selectedTimes);
          }
        }
        //console.log(bug['assigned_at'] + '...' + bug['implemented_at']);
        if (bug['assigned_at'] && bug['implemented_at']) {
          console.log("implemented_at: " + bug['implemented_at']);
          recordColumnDuration(bug, bug['assigned_at'], bug['implemented_at'], 'tti', implementTimes);
        }
        if (bug['merged_at'] && bug['implemented_at']) {
          recordColumnDuration(bug, bug['implemented_at'], bug['merged_at'], 'ttr', reviewTimes);
        }
        if (bug['verified_at'] && bug['merged_at']) {
          recordColumnDuration(bug, bug['merged_at'], bug['verified_at'], 'ttt', testTimes);
        }
        if (bug['verified_at']) {
          recordColumnDuration(bug, bug['created_at'], bug['verified_at'], 'ttc', releaseTimes);
        }
        num_bugs_processed++;
        percent_done = (num_bugs_processed / num_bugs_total) * 100;
        //console.log(percent_done);
        $('#progress-bar').width(percent_done + "%");
        if (percent_done == 100) {
          $('.progress').remove();
        }
      });

      var triage_time = calculateAverageDays(triageTimes);
      $('#triage-time').html(triage_time + " days (" + triageTimes.length + " bugs)");
      var selected_time = calculateAverageDays(selectedTimes);
      $('#selected-column .duration').html(selected_time + " days (" + selectedTimes.length + " bugs)");
      //console.log(implementTimes);
      var implement_time = calculateAverageDays(implementTimes);
      $('#implement-column .duration').html(implement_time + "days (" + implementTimes.length + " bugs)");
      var review_time = calculateAverageDays(reviewTimes);
      $('#review-column .duration').html(review_time + "days (" + reviewTimes.length + " bugs)");
      var test_time = calculateAverageDays(testTimes);
      $('#test-column .duration').html(test_time + "days (" + testTimes.length + " bugs)");
      var lead_time = calculateAverageDays(releaseTimes);
      $('#lead-time').html(lead_time + " days (" + releaseTimes.length + " bugs)");

      _.each(_.keys(kanBugs), function(key) {
        // Show current count at top of column
        var selector = "#" + key + "-column .count";
        $(selector).html($(kanBugs[key]).length);
      });
    };

    var kanbanAllTheBugs = function(e) {
      e.preventDefault();
      console.log('kanbanAllTheBugs');
      $('.progress').show();
      loadGhBugs();
      $.when.apply($, ghRequests).done(function(){
        // Get bugs from Bugzilla
        var whiteboard = $('form#filters input#whiteboard').val();
        var bugzillaURL = "https://api-dev.bugzilla.mozilla.org/latest/bug" +
                          "?product=Mozilla%20Developer%20Network" +
                          "&whiteboard=" + whiteboard +
                        "&include_fields=id,summary,component,creation_time,creator,status,resolution,whiteboard,assigned_to,depends_on,blocks,history,cf_last_resolved";
        $('#progress-bar').text("Fetching bugs from bugzilla ...");
        console.log("fetching: " + bugzillaURL);
        var gettingBugs = $.getJSON(bugzillaURL);
        $.when(gettingBugs).done(processBzBugs);
      });
    }

    $('.progress').hide();
    $('form#filters button').click(kanbanAllTheBugs);
});
