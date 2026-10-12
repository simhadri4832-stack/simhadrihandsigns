import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";

// Teachable Machine cloud model (no local model files needed)
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/oVaWjsnyf/";
const THRESHOLD = 0.85; // minimum confidence to accept a gesture

export default function App() {
  const boxRef = useRef(null);
  const webcamRef = useRef(null);
  const modelRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const recordingRef = useRef(false);
  const lastLoggedRef = useRef("");
  const fileRef = useRef(null);
  const imgUrlRef = useRef(null);

  const [status, setStatus] = useState("idle"); // idle | loading | running | image | error
  const [error, setError] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [current, setCurrent] = useState(null);
  const [recording, setRecording] = useState(false);
  const [records, setRecords] = useState([]);
  const [image, setImage] = useState(null); // { url, name }

  const addRecord = useCallback((gesture, prob, source) => {
    setRecords((r) => [
      ...r,
      {
        id: r.length + 1,
        time: new Date().toISOString(),
        source,
        gesture,
        confidence: Number(prob.toFixed(3)),
      },
    ]);
  }, []);

  // Load the cloud model once and reuse it
  const loadModel = async () => {
    if (modelRef.current) return modelRef.current;
    if (!window.tmImage) {
      throw new Error("Teachable Machine library failed to load. Check your internet connection.");
    }
    modelRef.current = await window.tmImage.load(
      MODEL_URL + "model.json",
      MODEL_URL + "metadata.json"
    );
    return modelRef.current;
  };

  const clearImage = () => {
    if (imgUrlRef.current) {
      URL.revokeObjectURL(imgUrlRef.current);
      imgUrlRef.current = null;
    }
    setImage(null);
  };

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    webcamRef.current.update();
    const preds = await modelRef.current.predict(webcamRef.current.canvas);
    if (!runningRef.current) return;
    const sorted = [...preds].sort((a, b) => b.probability - a.probability);
    setPredictions(preds.map((p) => ({ name: p.className, prob: p.probability })));

    const top = sorted[0];
    if (top.probability >= THRESHOLD) {
      setCurrent({ name: top.className, prob: top.probability });
      if (recordingRef.current && lastLoggedRef.current !== top.className) {
        lastLoggedRef.current = top.className;
        addRecord(top.className, top.probability, "camera");
      }
    } else {
      setCurrent(null);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [addRecord]);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    if (webcamRef.current) {
      webcamRef.current.stop();
      webcamRef.current = null;
    }
    if (boxRef.current) boxRef.current.innerHTML = "";
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const stop = useCallback(() => {
    stopCamera();
    setCurrent(null);
    setPredictions([]);
    setStatus("idle");
  }, [stopCamera]);

  useEffect(() => () => {
    stopCamera();
    if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current);
  }, [stopCamera]);

  const start = async () => {
    try {
      setError("");
      stopCamera();
      clearImage();
      setCurrent(null);
      setPredictions([]);
      setStatus("loading");

      const model = await loadModel();
      const webcam = new window.tmImage.Webcam(480, 360, true); // true = mirror
      await webcam.setup();
      await webcam.play();

      webcamRef.current = webcam;
      boxRef.current.innerHTML = "";
      boxRef.current.appendChild(webcam.canvas);
      modelRef.current = model;

      runningRef.current = true;
      setStatus("running");
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      setError(e.message || "Something went wrong");
      setStatus("error");
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (JPG, PNG, WEBP...).");
      return;
    }
    try {
      setError("");
      stopCamera();
      clearImage();
      setCurrent(null);
      setPredictions([]);
      setStatus("loading");

      const model = await loadModel();
      const url = URL.createObjectURL(file);
      imgUrlRef.current = url;

      const img = new Image();
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Could not read that image."));
      });

      const preds = await model.predict(img);
      const top = [...preds].sort((a, b) => b.probability - a.probability)[0];
      setPredictions(preds.map((p) => ({ name: p.className, prob: p.probability })));
      setCurrent(top.probability >= THRESHOLD ? { name: top.className, prob: top.probability } : null);
      setImage({ url, name: file.name, top: { name: top.className, prob: top.probability } });
      setStatus("image");
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong");
      setStatus("error");
    }
  };

  const toggleRecording = () => {
    const next = !recording;
    recordingRef.current = next;
    lastLoggedRef.current = "";
    setRecording(next);
  };

  const saveImageResult = () => {
    if (image && current) addRecord(current.name, current.prob, `image:${image.name}`);
  };

  const download = (content, filename, type) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const rows = ["id,time,source,gesture,confidence"].concat(
      records.map((r) => `${r.id},${r.time},"${r.source}",${r.gesture},${r.confidence}`)
    );
    download(rows.join("\n"), "gestures.csv", "text/csv");
  };

  const exportJSON = () =>
    download(JSON.stringify(records, null, 2), "gestures.json", "application/json");

  const busy = status === "loading";

  return (
    <div className="app">
      <h1>Hand Gesture Recognition System</h1>
      <p className="sub">React.js + Teachable Machine (cloud) + Webcam</p>

      <div className="layout">
        <section className="card">
          <div className="video">
            {/* webcam canvas is injected here */}
            <div ref={boxRef} className="cam" style={{ display: status === "running" ? "block" : "none" }} />
            {status === "image" && image && (
              <img className="preview" src={image.url} alt={image.name} />
            )}
            {status !== "running" && status !== "image" && (
              <div className="placeholder">
                {busy ? "Loading model..." : "Start the camera or upload an image"}
              </div>
            )}
          </div>

          <div className="buttons">
            {status !== "running" ? (
              <button onClick={start} disabled={busy}>Start Camera</button>
            ) : (
              <>
                <button className="danger" onClick={stop}>Stop</button>
                <button className={recording ? "rec" : ""} onClick={toggleRecording}>
                  {recording ? "Stop Recording" : "Start Recording"}
                </button>
              </>
            )}
            <button className="secondary" onClick={() => fileRef.current.click()} disabled={busy}>
              Upload Image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              style={{ display: "none" }}
            />
            {status === "image" && (
              <>
                <button onClick={saveImageResult} disabled={!current}>Save Result</button>
                <button className="danger" onClick={() => { clearImage(); setPredictions([]); setCurrent(null); setStatus("idle"); }}>
                  Clear Image
                </button>
              </>
            )}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="result">
            {current ? (
              <>
                <span className="gesture">{current.name}</span>
                <span className="conf">{(current.prob * 100).toFixed(1)}%</span>
              </>
            ) : (
              <span className="muted">
                {status === "running" || status === "image"
                  ? "No gesture detected"
                  : "Detected gesture appears here"}
              </span>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Predictions</h2>
          {predictions.length === 0 && (
            <p className="muted">Start the camera or upload an image to see results.</p>
          )}
          {predictions.map((p) => (
            <div key={p.name} className="bar-row">
              <span className="bar-label">{p.name}</span>
              <div className="bar">
                <div className="fill" style={{ width: `${p.prob * 100}%` }} />
              </div>
              <span className="bar-val">{(p.prob * 100).toFixed(0)}%</span>
            </div>
          ))}

          <h2 style={{ marginTop: 24 }}>Recorded Gestures ({records.length})</h2>
          <div className="buttons">
            <button onClick={exportCSV} disabled={!records.length}>Export CSV</button>
            <button onClick={exportJSON} disabled={!records.length}>Export JSON</button>
            <button className="danger" onClick={() => setRecords([])} disabled={!records.length}>
              Clear
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Time</th><th>Source</th><th>Gesture</th><th>Conf.</th></tr>
              </thead>
              <tbody>
                {records.slice().reverse().map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{new Date(r.time).toLocaleTimeString()}</td>
                    <td>{r.source.startsWith("image:") ? "image" : r.source}</td>
                    <td>{r.gesture}</td>
                    <td>{(r.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
