'use strict';

const https = require('https');
const tar = require('tar');
const fs = require('fs');
const walk = require('walkdir');

const LineByLineReader = require('line-by-line');
const hell = new (require(__dirname + "/helper.js"))({module_name: "rule"});

module.exports = function (rule) {

  /**
   * LOOP RULE FILES
   *
   * @param rule_files
   */
  rule.loopRuleFiles = async function (rule_files, feed) {
    hell.o("start", "loopRuleFiles", "info");

    const Ruleset = rule.app.models.ruleset;

    // return new Promise(function (success, reject) {

    // (async function () {

    let file_check, ruleset_check, ruleset_name, ruleset_insert, filename;
    for (let file_full_path of rule_files) {

      filename = file_full_path.split("/").pop();

      if (!filename.includes(".rules")) {
        // hell.o([filename, " not rules file - ignore"], "loopRuleFiles", "info");
        continue;
      }

      // hell.o([filename, "loop"], "loopRuleFiles", "info");

      // if (!/\.rules$/.test(filename)) continue; // ignore not .rules files

      //import only a subset of all the rules while development / testing
      if (process.env.NODE_ENV == "dev") {
        if ( filename.includes("drop")
          // || ( filename.includes("pop3") && feed.name == "emerging_pro" )
        ) {}
            else continue;
          // !filename.includes("drop")
        // !filename.includes("pop3") && !filename.includes("shellcode") &&
        // !filename.includes("telnet") && !filename.includes("chat") &&
        // !filename.includes("drop") && !filename.includes("ftp")
        // ) {
          // hell.o([filename, " dev mode - ignore"], "loopRuleFiles", "info");
          // continue;
        // } // for testing
      }

      // hell.o([filename, "loop"], "loopRuleFiles", "info");

      ruleset_name = filename.replace("emerging-", "");
      ruleset_name = ruleset_name.replace(".rules", "");
      ruleset_insert = {name: ruleset_name};

      /*
      IF NEW RULESET, CREATE
       */
      // hell.o([ruleset_name, "find"], "loopRuleFiles", "info");
      ruleset_check = await Ruleset.findOrCreate({where: ruleset_insert, include: ["tags"]}, ruleset_insert);
      if (!ruleset_check) throw new Error("failed to find / create ruleset");
      ruleset_check = ruleset_check[0];
      //hell.o("done", "checkNewRulesForDetector", "info");

      /*
      CHECK RULE FILE
       */
      // hell.o([ruleset_name, "check file"], "loopRuleFiles", "info");
      file_check = await rule.checkRuleFile({path: file_full_path, ruleset: ruleset_check, feed: feed}).then(value => {
        return value;
      }).catch(err => {
        hell.o([ruleset_name, "check file result"], "loopRuleFiles", "error");
        // reject( err );
        return err;
      });

      // hell.o([ruleset_name, "loop done for " + file_check], "loopRuleFiles", "info");
      hell.o(["==================================="], "loopRuleFiles", "info");

    };

    hell.o("done", "loopRuleFiles", "info");
    hell.o("===================================", "loopRuleFiles", "info");
    // success( true );
    return true;

    // })(); //async

    // }); //promise

  };

  /**
   * CHECK RULE FILE
   * line by line
   *
   * @param params
   */
  rule.checkRuleFile = async function (params) {
    hell.o(["start", params.ruleset.name], "checkRuleFile", "info");

    // return new Promise(function (success, reject) {

    let lineno = 0;
    let lr = new LineByLineReader(params.path);

    lr.on('error', function (err) {
      hell.o(err, "checkRuleFile", "error");
      return err;
    });

    lr.on('line', function (line) {
      lineno++;

      lr.pause();

      /*
      CHECK ONE RULE
       */
      // rule.checkRuleLine({ruleset: params.ruleset, line: line, feed: params.feed}).then(value => {
      //   lr.resume();
      // }).catch(err => {
      //   hell.o(err, "checkRuleFile", "error");
      //   reject("error");
      // });


      // await rule.checkRuleLine({ruleset: params.ruleset, line: line, feed: params.feed});
      rule.checkRuleLine({ruleset: params.ruleset, line: line, feed: params.feed}).then(value => {
        lr.resume();
      });


    }); // lr.on

    lr.on('end', function () {
      hell.o("done", "checkRuleFile", "info");
      // success(lineno);
      return lineno;
    });

    // }); // promise

  };

  /**
   * CHECK RULE LINE FROM FILE
   *
   * @param params
   */
  rule.checkRuleLine = async function (params) {
    //hell.o( "start" , "checkRuleLine", "info" );
    // return new Promise(function (success, reject) {

    let line = params.line;
    let feed = params.feed;
    let ruleset = params.ruleset;
    // console.log( [ feed.name, feed.tags()] );

    //not a rule line, comments etc
    if (!((line).startsWith("#alert") || (line).startsWith("alert"))) return true; // console.log( line );

    let sid = parseInt(line.match(/sid:([0-9]*);/)[1]);
    // hell.o([sid, "start"], "checkRuleLine", "info");
    let revision = parseInt(line.match(/rev:([0-9]*);/)[1]);
    let classtype = line.match(/classtype:(.*?);/)[1];

    let message = line.match(/msg:"(.*?)"/)[1];
    let severity = line.match(/signature_severity.(.+?),/);

    if (severity && severity.constructor === Array) {
      severity = severity[1];
    }

    let enabled = true;
    if (line.charAt(0) == "#") {
      line = line.substr(1); //remove the hashtag
      enabled = false;
    }

    let primary = false;
    if (feed.primary) {
      primary = true;
    }

    let rule_info = {
      sid: sid,
      revision: revision,
      primary: primary,
      feed_name: feed.name,
      classtype: classtype,
      enabled: enabled,
      published: enabled,
      severity: severity,
      ruleset: ruleset.name,
      message: message,
      rule_data: line,
      modified_time: new Date()
    };

    // (async function () {
    try {



      //check if we have this classtype in db
      if (classtype !== "" || classtype !== undefined) {
        let classtype_found = await rule.app.models.rule_classtype.findOrCreate({where: {name: classtype}}, {name: classtype});
      }

      let update_result, tag_rule, rs_tags = ruleset.tags(), fd_tags = feed.tags(), draft_input,
        create_extra = false, update_current = false, delete_current_feed_id = false, rule_to_change;

      //check if we have rules with the same SID
      let rule_found = await rule.find({where: {sid: sid}});


      // hell.o([feed.name + " primary feed?: ", feed.primary], "checkRuleLine", "info");


      // hell.o([rule_found.revision, revision], "checkRuleLine", "info");

      if( rule_found.length > 2 ){
        hell.o([sid, feed.name, "found more than two"], "checkRuleLine", "error");
        return false;
      }

      // if( sid == 2400032 ){
      //   console.log( "==========================" );console.log( "==========================" );console.log( "==========================" );
      //   console.log( rule_info );
      //   console.log( "==========================" );console.log( "==========================" );console.log( "==========================" );
      //   console.log( rule_found );
      //   console.log( "==========================" );console.log( "==========================" );console.log( "==========================" );
      // }

      /**
       * ONE RULE FOUND IN DB
       */
      if (rule_found.length == 1) {
        // if( sid == 2400032 ){
        //   console.log( "found one");
        // }
        // hell.o([sid, feed.name, "found one"], "checkRuleLine", "info")

        //same feed and same rev, no changes
        rule_to_change = rule_found[0];

        if (rule_info.primary == rule_to_change.primary && rule_info.revision == rule_to_change.revision) {
          // hell.o([sid, feed.name, "no changes "], "checkRuleLine", "info");
          return true;
        }
        //if new is primary, existing is not and same rev
        if (rule_info.primary && !rule_to_change.primary && rule_info.revision == rule_to_change.revision) {
          // hell.o([sid, feed.name, "existing and primary now the same, replace with primary"], "checkRuleLine", "info");
          delete_current_feed_id = rule_to_change.id;
          create_extra = true;
        }

        //if new is primary, existing is not
        if (rule_info.primary && !rule_to_change.primary) {
          // hell.o([sid, feed.name, "set create extra"], "checkRuleLine", "info");
          create_extra = true;
        }

        //same feed and new has higher rev
        if (rule_info.primary == rule_to_change.primary && rule_info.revision > rule_to_change.revision) {
          // hell.o([sid, feed.name, "set update current"], "checkRuleLine", "info");
          update_current = true;
        }
        //new is not primary and new has a higher rev
        console.log( rule_info.primary, rule_to_change.primary, rule_info.revision, rule_to_change.revision );
        if (!rule_info.primary && rule_to_change.primary && rule_info.revision > rule_to_change.revision) {
          // hell.o([sid, feed.name, "set create new"], "checkRuleLine", "info");
          create_extra = true;
        }
      } // end of rule_found.length == 1


      /**
       * TWO RULES FOUND IN DB
       */
      let primary_rule, feed_rule;
      if (rule_found.length == 2) {
        // if( sid == 2400032 ){
        //   console.log( "found two");
        // }
        // hell.o([sid, feed.name, "found two"], "checkRuleLine", "info");
        for (let i = 0, l = rule_found.length; i < l; i++) {
          if (rule_found[i].primary == true) {
            primary_rule = rule_found[i];
            if (rule_info.primary) rule_to_change = primary_rule;
          } else {
            feed_rule = rule_found[i];
            if (!rule_info.primary) rule_to_change = feed_rule;
          }
        }

        //primary rule, no changes
        if (rule_info.primary && rule_info.revision == primary_rule.revision) {
          // hell.o([sid, feed.name, "no changes "], "checkRuleLine", "info");
          return true;
        }

        //feed rule, no changes
        if (!rule_info.primary && rule_info.revision == feed_rule.revision) {
          // hell.o([sid, feed.name, "no changes "], "checkRuleLine", "info");
          return true;
        }

        //if new is primary and has a higher rev, and new rev equals feed.rev
        if (rule_info.primary && rule_info.revision > primary_rule.revision && rule_info.revision == feed_rule.revision) {
          // hell.o([sid, feed.name, "existing and primary now the same, replace with primary"], "checkRuleLine", "info");
          delete_current_feed_id = feed_rule.id;
          update_current = true;
        }

        //if new is feed and has higher rev
        if (!rule_info.primary && rule_info.revision > feed_rule.revision) {
          update_current = true;
        }

      } //end of rule_found.length == 2

      /**
       * NO RULES FOUND IN DB, CREATE
       */
      if (rule_found.length == 0 || create_extra === true) {
        hell.o([sid, "no rule found, create"], "checkRuleLine", "info");
        // if( sid == 2400032 ){
        //   console.log( "none found");
        // }
        // console.log( feed.tags );
        // console.log( rs_tags );
        // console.log( fd_tags );
        if (!ruleset.automatically_enable_new_rules) {
          rule_info.enabled = false;
        }
        let rule_create = await rule.create(rule_info);
        if (!rule_create) throw new Error("failed to create rule");

        //add tags from ruleset
        if (rs_tags.length > 0) {
          for (let i = 0, l = rs_tags.length; i < l; i++) {
            tag_rule = await rule_create.tags.add(rs_tags[i]);
            if (!tag_rule) throw new Error(sid + " failed to add new tag from ruleset");
          }
        }

        //add tags from feed, if not primary
        if (!feed.primary && fd_tags.length > 0) {
          console.log( "FEED TAGS::::::::::" );
          console.log( fd_tags );
          for (let i = 0, l = fd_tags.length; i < l; i++) {
            tag_rule = await rule_create.tags.add(fd_tags[i]);
            if (!tag_rule) throw new Error(sid + " failed to add new tag from feed");
          }
        }

        rule_to_change = rule_create;

      } //rule_found.length == 0


      /**
       * REMOVE CURRENT FEED RULE by id
       */
      if (delete_current_feed_id !== false) {
        hell.o([sid, feed.name, "remove current feed rule"], "checkRuleLine", "info");
        let rule_remove = await rule.destroyById(delete_current_feed_id);
      }


      /**
       * AUTOMATIC UPDATE ALLOWED
       */
      if (ruleset.automatically_enable_new_rules && update_current) {
        hell.o([sid, "new revision update"], "checkRuleLine", "info");
        hell.o([feed.name + " primary feed: ", feed.primary], "checkRuleLine", "info");
        update_result = await rule.update({id: rule_to_change.id}, rule_info);
        if (!update_result) throw new Error(sid + " failed to update rule");
        hell.o([sid, "update ok"], "checkRuleLine", "info");
        return true;
      }

      /**
       * AUTOMATIC UPDATES NOT ALLOWED, DRAFT IT
       */

      // console.log( rule_info );
      // if( sid == 2400032 ){
      //   console.log( rule_info );
      //   console.log( "==========================" );
      //   console.log( rule_to_change );
      // }
      if (rule_to_change.revision == revision && rule_to_change.enabled != enabled) {
        //toggle enabled
        hell.o([sid, "enable change " + enabled], "checkRuleLine", "info");
        draft_input = {id: rule_to_change.id, enabled: enabled};
      } else { //must be new revision
        delete rule_to_change.modified_time;
        // rule_to_change.id = rule_to_change.id;
        draft_input = rule_to_change;

      }

      // hell.o([sid, "create draft"], "checkRuleLine", "info");
      // await rule.addToDraft(draft_input);


      // rule.app.models.rule_draft.more(draft_input, null, function () {
      //   hell.o([sid, "draft created"], "checkRuleLine", "info");
      //   // return success(true);
      //   return true;
      // });


      return true;
    } catch (err) {
      hell.o([sid, err], "checkRuleLine", "error");
      // reject(err);
      return false;
    }

    // })(); //async

    // }); //promise

  };


  rule.addToDraft = async function (draft_input) {
    hell.o([draft_input.sid, "add to draft"], "addToDraft", "info");

    rule.app.models.rule_draft.more([draft_input], null, function () {
      // hell.o([draft_input.sid, "done"], "addToDraft", "info");
      // return success(true);
      return true;
    });
  };

  /**
   * RETURN RULES PER DETECTOR
   *
   * get detector tags
   * get rules per tags
   * get rules without any tags
   * filtered by last_update
   *
   * @param detector_id
   * @param last_update : last changes from central
   * @returns {Promise}
   */
  rule.checkNewRulesForDetector = async function (detector_id, last_update) {
    hell.o("start", "checkNewRulesForDetector", "info");
    // return new Promise((success, reject) => {

    // (async function () {
    try {

      let rule_fields = ["sid", "revision", "classtype", "severity", "ruleset",
        "enabled", "message", "rule_data", "modified_time"
        //, "created_time"
      ];

      let detector = await rule.app.models.detector.findById(detector_id, {
        include: {
          relation: "tags",
          scope: {
            // fields: ["id","name"]
          }
        }
      });

      let detector_tags = detector.tags();
      if (detector_tags.length > 0) {
        hell.o(["found tags for detector", detector_tags], "checkNewRulesForDetector", "info");
      }

      /**
       * DETECTOR HAS TAGS
       */
      let rules_with_tags = [];
      if (detector.tags().length > 0) {

        let tags_filter = {
          where: {
            or: []
          },
          include: {
            relation: "rules"
          }
        };

        for (const t in detector.tags()) {
          tags_filter.where.or.push({"id": detector.tags()[t].id});
          console.log( "tag", detector.tags()[t].id );
        }

        tags_filter.include.scope = {
          fields: rule_fields
        };

        if (last_update == "full") {
          hell.o("perform full update on rules", "checkNewRulesForDetector", "info");
        } else {
          tags_filter.include.scope.where = {
            modified_time: {gt: last_update}
          };
        }

        // console.log( "tags_filter" );
        // console.log( tags_filter );
        let look_for_rules_w_tags = await rule.app.models.tag.find(tags_filter);

        //do we have actual rules in tags?
        if (look_for_rules_w_tags.length > 0) {
          for (const r in look_for_rules_w_tags) {
            if (rules_with_tags.concat(look_for_rules_w_tags[r].rules().length > 0)) {
              // console.log(look_for_rules_w_tags[r].rules().length);
              rules_with_tags = rules_with_tags.concat(look_for_rules_w_tags[r].rules());
            }
          }
        }

        hell.o(["rules with tags", rules_with_tags.length], "checkNewRulesForDetector", "info");

      } // DETECTOR HAS TAGS

      let public_filter =
        {
          fields: rule_fields,
          include: {
            relation: "tags"
          }
        };

      if (last_update != "full") {
        public_filter.where = {
          modified_time: {gt: last_update}
        }
      }

      let new_rules = await rule.find(public_filter);

      //get public rules ( no tags )
      new_rules = new_rules.filter(function (t) {
        return t.tags().length == 0;
      });
      hell.o(["new rules without tags", new_rules.length], "checkNewRulesForDetector", "info");

      //merge rules with tags
      new_rules = new_rules.concat(rules_with_tags);

      for (let i = 0, l = new_rules.length; i < l; i++) {
        new_rules[i].id = undefined;
        delete new_rules[i].id;
        delete new_rules[i].feed_name;
        delete new_rules[i].primary;
      }

      hell.o(["total new rules", new_rules.length], "checkNewRulesForDetector", "info");
      hell.o("done", "checkNewRulesForDetector", "info");
      // success(new_rules);
      return new_rules;
    } catch (err) {
      hell.o(err, "checkNewRulesForDetector", "error");
      // reject(false);
      return false;
    }

    // })(); // async

    // }); //promise

  };

};
