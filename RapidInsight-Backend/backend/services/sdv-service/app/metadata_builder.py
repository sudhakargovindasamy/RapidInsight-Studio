"""Turn the caller's column list into SDV metadata and a typed DataFrame.

Why this file exists at all
---------------------------
SDV can work out column types on its own with Metadata.detect_from_dataframe.
We never use it. Tested on 2026-08-05 against sdv 1.37.4: a plain column named
"city" holding Tokyo/Paris/Berlin was auto-classified as personal information
and every value was replaced with an invented placeholder (Port Brenda,
Amandabury) - SDV substitutes those internally rather than learning the real
values. It decides this from the column *name*, so any schema with a column
called city, name, email or phone is silently corrupted, and the output still
looks plausible enough to pass a glance.

Passing an explicit sdtype for every column is what prevents that, and it is why
the caller is required to send one.
"""

import pandas as pd
from sdv.metadata import Metadata

from .models import ColumnSpec


def build_metadata(table_name: str, columns: list[ColumnSpec]) -> Metadata:
    """Build SDV metadata from explicit column types only."""
    column_dict: dict[str, dict] = {}

    for column in columns:
        entry: dict[str, object] = {"sdtype": column.sdtype}

        if column.sdtype == "datetime" and column.datetime_format:
            entry["datetime_format"] = column.datetime_format

        column_dict[column.name] = entry

    return Metadata.load_from_dict(
        {
            "tables": {table_name: {"columns": column_dict}},
            "METADATA_SPEC_VERSION": "V1",
        }
    )


def build_dataframe(
    seed_rows: list[dict], columns: list[ColumnSpec]
) -> pd.DataFrame:
    """Coerce the seed rows into the dtypes the declared sdtypes imply.

    Seed rows arrive as JSON, so every value is a string, number, bool or null.
    Handing SDV a datetime column full of strings makes it treat the column as
    free text, which is the same class of bug the explicit metadata prevents.
    """
    frame = pd.DataFrame(seed_rows)

    for column in columns:
        # A column the LLM omitted entirely still has to exist, or SDV and the
        # metadata disagree about the shape of the table.
        if column.name not in frame.columns:
            frame[column.name] = pd.NA

        series = frame[column.name]

        if column.sdtype == "numerical":
            frame[column.name] = pd.to_numeric(series, errors="coerce")

        elif column.sdtype == "datetime":
            frame[column.name] = pd.to_datetime(
                series,
                format=column.datetime_format,
                errors="coerce",
            )

        elif column.sdtype == "boolean":
            frame[column.name] = _to_boolean(series)

        else:
            # Categorical. Keep nulls as nulls rather than the string "None",
            # which would become a legitimate-looking category of its own.
            frame[column.name] = series.astype("object").where(series.notna(), pd.NA)

    # Drop anything the caller did not declare. Extra columns in the seed rows
    # would otherwise be fitted and returned, which the caller is not expecting.
    return frame[[column.name for column in columns]]


def _to_boolean(series: pd.Series) -> pd.Series:
    truthy = {"true", "yes", "1", "t", "y"}
    falsy = {"false", "no", "0", "f", "n"}

    def convert(value):
        if isinstance(value, bool):
            return value

        if value is None or pd.isna(value):
            return pd.NA

        text = str(value).strip().lower()

        if text in truthy:
            return True

        if text in falsy:
            return False

        return pd.NA

    return series.map(convert).astype("boolean")