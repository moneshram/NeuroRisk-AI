from dataclasses import dataclass

ALLOWED = {
    "gender": {"Male", "Female", "Other"},
    "ever_married": {"Yes", "No"},
    "work_type": {"Private", "Self-employed", "Govt_job", "children", "Never_worked"},
    "residence_type": {"Urban", "Rural"},
    "smoking_status": {"formerly smoked", "never smoked", "smokes", "Unknown"},
}

@dataclass
class PatientInput:
    age: float
    gender: str
    hypertension: int
    heart_disease: int
    ever_married: str
    work_type: str
    residence_type: str
    avg_glucose_level: float
    bmi: float
    smoking_status: str

def validate_payload(data):
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")

    required = [
        "age", "gender", "hypertension", "heart_disease", "ever_married",
        "work_type", "residence_type", "avg_glucose_level", "bmi",
        "smoking_status"
    ]
    missing = [x for x in required if x not in data]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")

    try:
        age = float(data["age"])
        glucose = float(data["avg_glucose_level"])
        bmi = float(data["bmi"])
        hypertension = int(data["hypertension"])
        heart_disease = int(data["heart_disease"])
    except (TypeError, ValueError):
        raise ValueError("Numeric fields contain invalid values.")

    if not 0 <= age <= 120:
        raise ValueError("Age must be between 0 and 120.")
    if not 30 <= glucose <= 500:
        raise ValueError("Average glucose must be between 30 and 500 mg/dL.")
    if not 8 <= bmi <= 80:
        raise ValueError("BMI must be between 8 and 80.")
    if hypertension not in (0, 1) or heart_disease not in (0, 1):
        raise ValueError("Hypertension and heart disease must be 0 or 1.")

    for key, values in ALLOWED.items():
        if data[key] not in values:
            raise ValueError(f"Invalid {key}.")

    return PatientInput(
        age, data["gender"], hypertension, heart_disease,
        data["ever_married"], data["work_type"], data["residence_type"],
        glucose, bmi, data["smoking_status"]
    )
