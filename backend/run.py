from app import app

if __name__ == "__main__":
    # Keep the development server threaded so multiple forgot-password
    # requests can be accepted concurrently. Disable the reloader because it
    # would start a second mail dispatcher process during development.
    # debug=False: the Werkzeug debugger exposes an interactive console with
    # full code execution to anyone who can reach the port — never enable it,
    # even locally (app.py's error handlers already return JSON 500s).
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False, threaded=True)
