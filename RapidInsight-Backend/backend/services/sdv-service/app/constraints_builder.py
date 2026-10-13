"""Turn constraint specs into SDV constraint objects.

These cover the structural rules only - "this date comes before that one",
"this value sits between those two". They are domain-independent on purpose: the
same inequality that stops a delivery date preceding an order date stops a
discharge date preceding an admission date, with no per-industry knowledge.

Domain rules (dosage vs body weight, and so on) are not enforced here. They come
from the realism of the seed rows instead, and are statistically likely rather
than guaranteed. See section 12 of docs/sdv-migration-plan.md.
"""

from sdv.cag import FixedCombinations, Inequality, Range

from .models import ColumnSpec, ConstraintSpec


class ConstraintError(ValueError):
    """A constraint that cannot be applied to the declared columns."""


def build_constraints(
    constraints: list[ConstraintSpec],
    columns: list[ColumnSpec],
    table_name: str,
) -> list:
    """Build SDV constraint objects, rejecting ones that cannot hold.

    A constraint naming a column that was never declared would fail deep inside
    SDV's fit with an opaque message. Checking here means the caller gets told
    exactly which column is missing.
    """
    known = {column.name for column in columns}
    built = []

    for constraint in constraints:
        if constraint.type == "fixed_combinations":
            if not constraint.columns or len(constraint.columns) < 2:
                raise ConstraintError(
                    "A fixed_combinations constraint requires at least two columns."
                )

            names = list(constraint.columns)
        else:
            if not constraint.low_column or not constraint.high_column:
                raise ConstraintError(
                    f"A {constraint.type} constraint requires low_column and "
                    f"high_column."
                )

            names = [constraint.low_column, constraint.high_column]

            if constraint.type == "range":
                if not constraint.middle_column:
                    raise ConstraintError(
                        "A range constraint requires middle_column."
                    )

                names.append(constraint.middle_column)

        missing = [name for name in names if name not in known]

        if missing:
            raise ConstraintError(
                f"Constraint references undeclared column(s): {', '.join(missing)}."
            )

        if constraint.type == "fixed_combinations":
            built.append(
                FixedCombinations(
                    column_names=list(constraint.columns),
                    table_name=table_name,
                )
            )

        elif constraint.type == "inequality":
            built.append(
                Inequality(
                    low_column_name=constraint.low_column,
                    high_column_name=constraint.high_column,
                    strict_boundaries=constraint.strict,
                    table_name=table_name,
                )
            )

        else:
            built.append(
                Range(
                    low_column_name=constraint.low_column,
                    middle_column_name=constraint.middle_column,
                    high_column_name=constraint.high_column,
                    strict_boundaries=constraint.strict,
                    table_name=table_name,
                )
            )

    return built