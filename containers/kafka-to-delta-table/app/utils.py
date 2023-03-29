import json
from azure.keyvault.secrets import SecretClient
from azure.identity import DefaultAzureCredential
from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    IntegerType,
    FloatType,
    BooleanType,
    TimestampType,
    DateType,
)


# TODO - turn this function into a method of AzureCredentialManager
def get_secret(secret_name: str, key_vault_name: str) -> str:
    """
    Get the value of a secret from an Azure key vault given the names of the vault and
    secret.

    :param secret_name: The name of the secret whose value should be retreived from the
        key vault.
    :param key_vault_name: The name of the key vault where the secret is stored.
    :return: The value of the secret specified by secret_name.
    """

    credential = DefaultAzureCredential()
    vault_url = f"https://{key_vault_name}.vault.azure.net"
    secret_client = SecretClient(vault_url=vault_url, credential=credential)
    return secret_client.get_secret(secret_name).value


SCHEMA_TYPE_MAP = {
    "string": StringType(),
    "integer": IntegerType(),
    "float": FloatType(),
    "double": DoubleType(),
    "boolean": BooleanType(),
    "date": DateType(),
    "timestamp": TimestampType(),
}


def get_spark_schema(json_schema: str) -> StructType:
    """
    Get a Spark StructType object from a JSON schema string.

    :param json_schema: A string representation of a Spark schema. Should be of the form
        '{"field1": "type1", "field2": "type2"}'.
    :return: A Spark StructType object.
    """

    schema = StructType()
    json_schema = json.loads(json_schema)
    for field in json_schema:
        schema.add(StructField(field, SCHEMA_TYPE_MAP[field], True))
    return schema


def validate_schema(json_schema: dict) -> dict:
    """
    Validate a JSON schema string.

    :param json_schema: A dictonary representation of a chema. Should be of the form
        {"field1": "type1", "field2": "type2"}.
    :return: A dictionary with 'valid' and 'error' keys. If the schema is valid then the
        value of 'valid' will be True and 'errors will be empty. If the schema is not
        valid then the value of 'valid' will be False and 'errors' will contain all of
        validations errors that were found.
    """
    validation_results = {"valid": True, "errors": []}
    valid_types = list(SCHEMA_TYPE_MAP.values())
    for field, type in json_schema.items():
        if type(field) != str:
            validation_results["valid"] = False
            validation_results["errors"].append(
                f"Invalid field {field}. Fields must be strings."
            )

        if type not in valid_types:
            validation_results["valid"] = False
            validation_results["errors"].append(
                f"Invalid type {type} for field {field}. Valid types are {valid_types}."
            )

    return validation_results
