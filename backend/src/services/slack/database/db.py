from os import environ
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL, echo=True)
Session = sessionmaker(engine)
session = Session()
