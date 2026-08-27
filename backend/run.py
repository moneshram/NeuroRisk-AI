from app import app

if __name__ == "__main__":
    # Keep the development server threaded so multiple forgot-password
    # requests can be accepted concurrently. Disable the reloader because it
    # would start a second mail dispatcher process during development.
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False, threaded=True)
