# set 'hosts', ['node-js.ru']
set 'nodever', '0.8.12'

namespace 'deploy', ->
    task 'status', ->
        run "sudo status #{roco.application}"

    task 'npm:update', ->
        run "cd #{roco.currentPath}; npm install -l"

    # task 'request', (done) ->
        # run "curl -I http://localhost:#{roco.appPort}/", done

namespace 'node', ->
  task 'update', (done) -> sequence 'download', 'unpack', 'compile', 'install', done
  task 'rebuild', (done) -> sequence 'unpack', 'compile', 'install', done
  task 'download', (done) ->
    run "cd /tmp && wget http://nodejs.org/dist/v#{roco.nodever}/node-v#{roco.nodever}.tar.gz", done
  task 'unpack', (done) ->
    run "cd /tmp && tar xfv node-v#{roco.nodever}.tar.gz", done
  task 'compile', (done) ->
    run "cd /tmp/node-v#{roco.nodever} && ./configure && make", done
  task 'install', (done) ->
    run "cd /tmp/node-v#{roco.nodever} && sudo make install", done

namespace 'git', ->
    task 'remote', ->
        app = roco.application
        run """
        mkdir #{app}.git;
        cd #{app}.git;
        git --bare init;
        true
        """, (res) ->
            localRun """
            git remote add origin #{res[0].host}:#{app}.git;
            git push -u origin master
            """

namespace 'i', ->
    task 'disk', (done) -> run 'df -h', done
    task 'top',  (done) -> run 'top -b -n 1 | head -n 12', done
    task 'who',  (done) -> run 'who', done
    task 'node', (done) -> run 'ps -eo args | grep node | grep -v grep', done
    task 'free', (done) -> run 'free', done

    task 'all', (done) ->
        sequence 'top', 'free', 'disk', 'node', done

    task 'log', ->
        run "tail -n 100 #{roco.sharedPath}/log/#{roco.env}*"

after 'i:disk', 'i:node'

# after 'deploy:start', 'deploy:request'
# after 'deploy:restart', 'deploy:request'
