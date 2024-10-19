from flask import Flask, Response
import time
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/')
def stream():
    def generate():
        for i in range(1, 6):
            yield f"data: Chunk {i}\n"
            time.sleep(1)
        yield 'data: End of streaming\n'

    return Response(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(debug=True)
