path = require('path')

ensure 'application', ->
    abort 'Please specify application name, set "application", "foo"'
ensure 'repository', ->
    abort 'Please specify repository url, set "repository", "/home/git/myrepo.git"'

ensure 'scm', 'git'
ensure 'branch', 'master'
ensure 'deployTo', -> "/var/www/apps/#{roco.application}"
ensure 'releaseName', Date.now().toString()
ensure 'releasesDir', 'releases'
ensure 'sharedDir',   'shared'
ensure 'currentDir',  'current'
ensure 'releasesPath', -> path.resolve(roco.deployTo, roco.releasesDir)
ensure 'sharedPath',   -> path.resolve(roco.deployTo, roco.sharedDir)
ensure 'currentPath',  -> path.resolve(roco.deployTo, roco.currentDir)
ensure 'releasePath',  -> path.resolve(roco.releasesPath, roco.releaseName)
ensure 'env', 'production'
ensure 'nodeEntry', 'server.js'
ensure 'appPort', 3001

namespace 'deploy', ->

    desc """
        Update code and restart server
    """
    task 'default', (done) -> sequence 'update', 'restart', done

    desc """
        Pull latest changes from SCM and symlink latest release
        as current release
    """
    task 'update',  (done) -> sequence 'updateCode', 'symlink', done

    task 'updateCode', (done) ->
        localRun "git ls-remote #{roco.repository} #{roco.branch}", (x) ->
            head = x.split(/\s+/).shift()
            run """
                if [ -d #{roco.sharedPath}/cached-copy ];
                  then cd #{roco.sharedPath}/cached-copy &&
                  git fetch -q origin && git fetch --tags -q origin &&
                  git reset -q --hard #{head} && git clean -q -d -x -f;
                else
                  git clone -q #{roco.repository} #{roco.sharedPath}/cached-copy &&
                  cd #{roco.sharedPath}/cached-copy &&
                  git checkout -q -b deploy #{head};
                fi
                """, ->
                    run """
                        cd #{roco.sharedPath}/cached-copy;
                        npm install -l;
                        cp -RPp #{roco.sharedPath}/cached-copy #{roco.releasePath}
                        """, done

    task 'symlink', (done) ->
        run """
          rm -f #{roco.currentPath};
          ln -s #{roco.releasePath} #{roco.currentPath};
          ln -s #{roco.sharedPath}/log #{roco.currentPath}/log;
          true
          """, done

    task 'restart', (done) ->
        run "sudo restart #{roco.application} || sudo start #{roco.application}", done

    task 'start', (done) ->
        run "sudo start #{roco.application}", done

    task 'stop', (done) ->
        run "sudo stop #{roco.application}", done

    task 'setup', (done) ->
        dirs = [roco.deployTo, roco.releasesPath, roco.sharedPath, roco.sharedPath + '/log'].join(' ')
        run """
            NAME=`whoami`;
            sudo mkdir -p #{dirs} &&
            sudo chown -R $NAME:$NAME #{dirs}
            """, done

    task 'setup:upstart', (done) ->
        sequence 'setup', 'writeUpstartScript', done

    task 'writeUpstartScript', (done) ->
        ups = """
          description "#{roco.application}"

          start on startup
          stop on shutdown

          script
              cd #{roco.currentPath}
              exec sudo sh -c "NODE_ENV=#{roco.env} PORT=#{roco.appPort} /usr/local/bin/node #{roco.currentPath}/#{roco.nodeEntry} >> #{roco.sharedPath}/log/#{roco.env}.log 2>&1"
          end script
          respawn
          """
        run "sudo echo '#{ups}' > /tmp/upstart.tmp && sudo mv /tmp/upstart.tmp /etc/init/#{roco.application}.conf", done

